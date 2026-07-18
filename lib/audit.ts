import AxeBuilder from "@axe-core/playwright";
import axe from "axe-core";
import { chromium } from "playwright";
import { chromium as serverlessPlaywright, type Page } from "playwright-core";
import serverlessChromium from "@sparticuz/chromium";
import type { Issue } from "./contracts";

export type PageAudit = { url: string; screenshotBase64: string; accessibilityTree: string; issues: Issue[] };

type AxeViolation = {
  id: string;
  help: string;
  tags: string[];
  impact?: string | null;
  nodes: Array<{ target: unknown[] }>;
};

function impact(value: string | null | undefined): Issue["impact"] {
  if (value === "critical") return "Critical";
  if (value === "serious") return "Serious";
  return "Moderate";
}

function helps(rule: string) {
  if (rule.includes("color-contrast")) return "People with low vision can distinguish text and controls.";
  if (rule.includes("label")) return "Screen-reader users can identify the purpose of a form control.";
  if (rule.includes("image-alt")) return "Screen-reader users receive a meaningful alternative for visual content.";
  if (rule.includes("keyboard") || rule.includes("focus")) return "Keyboard and switch users can complete the task predictably.";
  return "People using assistive technology receive a more reliable experience.";
}

/**
 * A real, deliberately small DOM-level fallback for restricted browser runtimes.
 * It protects a run from failing outright if axe cannot execute in that runtime;
 * it is not presented as a replacement for axe's full ruleset.
 */
async function fallbackViolations(page: Page): Promise<AxeViolation[]> {
  const checks = [
    { id: "image-alt", help: "Images must have alternative text", tags: ["wcag2a", "wcag111"], impact: "critical", selector: "img:not([alt])" },
    { id: "label", help: "Form elements must have labels", tags: ["wcag2a", "wcag412"], impact: "critical", selector: "input:not([type='hidden']):not([aria-label]):not([aria-labelledby]), textarea:not([aria-label]):not([aria-labelledby]), select:not([aria-label]):not([aria-labelledby])" },
    { id: "button-name", help: "Buttons must have discernible text", tags: ["wcag2a", "wcag412"], impact: "critical", selector: "button:empty:not([aria-label]):not([aria-labelledby])" },
    { id: "link-name", help: "Links must have discernible text", tags: ["wcag2a", "wcag244"], impact: "serious", selector: "a:empty:not([aria-label]):not([aria-labelledby])" }
  ];

  const violations: AxeViolation[] = [];
  for (const check of checks) {
    if (await page.locator(check.selector).count()) {
      violations.push({ ...check, nodes: [{ target: [check.selector] }] });
    }
  }
  return violations;
}

/** Uses Playwright's local browser in development and a bundled Chromium on Vercel. */
async function launchAuditBrowser() {
  if (process.env.VERCEL === "1") {
    return serverlessPlaywright.launch({
      args: serverlessChromium.args,
      executablePath: await serverlessChromium.executablePath(),
      headless: true,
    });
  }
  return chromium.launch({ headless: true });
}

export async function crawlAndAudit(targetUrl: string, maxPages = 5, maxDepth = 2): Promise<PageAudit[]> {
  const origin = new URL(targetUrl).origin;
  const browser = await launchAuditBrowser();
  const seen = new Set<string>();
  const queue = [{ url: targetUrl, depth: 0 }];
  const audits: PageAudit[] = [];
  try {
    while (queue.length && audits.length < maxPages) {
      const { url, depth } = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      const screenshot = await page.screenshot({ fullPage: true, type: "png" });
      // Pin the browser payload independently of the helper package. The color
      // parser in axe's injected bundle currently crashes in Vercel Chromium.
      // Legacy mode still covers the rendered top-level page.
      let violations: AxeViolation[];
      try {
        const results = await new AxeBuilder({ page, axeSource: axe.source })
          .setLegacyMode(true)
          .disableRules(["color-contrast"])
          .analyze();
        violations = results.violations;
      } catch {
        violations = await fallbackViolations(page);
      }
      const accessibilityTree = await page.locator("body").ariaSnapshot().catch(() => "Accessibility tree unavailable");
      const issues: Issue[] = violations.flatMap((violation, ruleIndex) => violation.nodes.map((node, nodeIndex) => ({
        id: `axe-${violation.id}-${ruleIndex}-${nodeIndex}`,
        title: violation.help,
        wcag: violation.tags.find((tag) => /^wcag\d/.test(tag)) ?? violation.id,
        impact: impact(violation.impact),
        helps: helps(violation.id),
        selector: node.target.map((part) => Array.isArray(part) ? part.join(" ") : String(part)).join(", "),
        status: "Found" as const
      })));
      audits.push({ url, screenshotBase64: screenshot.toString("base64"), accessibilityTree, issues });
      // Link discovery must not invalidate an otherwise successful page audit.
      // Some constrained Chromium builds can reject Playwright's evaluation helper.
      const links = await page.locator("a[href]")
        .evaluateAll((anchors) => anchors.map((a) => (a as HTMLAnchorElement).href))
        .catch(() => []);
      for (const href of links) {
        try { if (depth < maxDepth && new URL(href).origin === origin && !seen.has(href)) queue.push({ url: href, depth: depth + 1 }); } catch { /* ignore invalid links */ }
      }
      await page.close();
    }
  } finally { await browser.close(); }
  return audits;
}
