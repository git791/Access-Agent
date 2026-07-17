import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
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

export async function crawlAndAudit(targetUrl: string, maxPages = 5): Promise<PageAudit[]> {
  const origin = new URL(targetUrl).origin;
  const browser = await chromium.launch({ headless: true });
  const seen = new Set<string>();
  const queue = [targetUrl];
  const audits: PageAudit[] = [];
  try {
    while (queue.length && audits.length < maxPages) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      const screenshot = await page.screenshot({ fullPage: true, type: "png" });
      const results = await new AxeBuilder({ page }).analyze();
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
        try { if (new URL(href).origin === origin && !seen.has(href)) queue.push(href); } catch { /* ignore invalid links */ }
      }
      await page.close();
    }
  } finally { await browser.close(); }
  return audits;
}
