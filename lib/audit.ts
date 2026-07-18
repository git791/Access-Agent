import AxeBuilder from "@axe-core/playwright";
import axe from "axe-core";
import { chromium } from "playwright";
import { chromium as serverlessPlaywright } from "playwright-core";
import serverlessChromium from "@sparticuz/chromium";
import type { Issue } from "./contracts";

export type PageAudit = { url: string; screenshotBase64: string; accessibilityTree: string; issues: Issue[] };

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
      // Pin the browser payload independently of the helper package: axe 4.12's
      // injected bundle currently crashes in Vercel's minimal Chromium runtime.
      // Legacy mode still runs the full ruleset on the rendered top-level page.
      const results = await new AxeBuilder({ page, axeSource: axe.source }).setLegacyMode(true).analyze();
      const accessibilityTree = await page.locator("body").ariaSnapshot().catch(() => "Accessibility tree unavailable");
      const issues: Issue[] = results.violations.flatMap((violation, ruleIndex) => violation.nodes.map((node, nodeIndex) => ({
        id: `axe-${violation.id}-${ruleIndex}-${nodeIndex}`,
        title: violation.help,
        wcag: violation.tags.find((tag) => /^wcag\d/.test(tag)) ?? violation.id,
        impact: impact(violation.impact),
        helps: helps(violation.id),
        selector: node.target.join(", "),
        status: "Found" as const
      })));
      audits.push({ url, screenshotBase64: screenshot.toString("base64"), accessibilityTree, issues });
      const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((a) => (a as HTMLAnchorElement).href));
      for (const href of links) {
        try { if (depth < maxDepth && new URL(href).origin === origin && !seen.has(href)) queue.push({ url: href, depth: depth + 1 }); } catch { /* ignore invalid links */ }
      }
      await page.close();
    }
  } finally { await browser.close(); }
  return audits;
}
