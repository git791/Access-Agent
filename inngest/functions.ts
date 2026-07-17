import { inngest } from "./client";
import { crawlAndAudit } from "../lib/audit";
import { inspectRenderedPage } from "../lib/visual-audit";
import { saveAudit, updateRun } from "../lib/store";

type AuditEvent = { name: "accessagent/audit.requested"; data: { runId: string; targetUrl: string; maxPages: number } };

export const auditWorkflow = inngest.createFunction(
  { id: "audit-patch-verify", retries: 2 },
  { event: "accessagent/audit.requested" },
  async ({ event, step }) => {
    const data = (event as AuditEvent).data;
    await step.run("mark-auditing", () => updateRun(data.runId, { status: "auditing", message: "Capturing rendered pages and running axe-core." }));
    const pages = await step.run("crawl-and-static-audit", () => crawlAndAudit(data.targetUrl, data.maxPages));
    const audits = await Promise.all(pages.map((page) => step.run(`visual-audit-${new URL(page.url).pathname || "root"}`, async () => {
      const screenshot = Buffer.from(page.screenshotBase64, "base64");
      const visual = await inspectRenderedPage(screenshot, page.accessibilityTree, page.issues);
      const issues = [...page.issues, ...visual];
      await saveAudit(data.runId, page.url, screenshot, issues);
      return { url: page.url, issueCount: issues.length };
    })));
    const issueCount = audits.reduce((count, page) => count + page.issueCount, 0);
    await step.run("mark-human-review", () => updateRun(data.runId, {
      status: "needs_review",
      message: issueCount === 0 ? "Audit completed: no issues found." : "Audit completed. Patching is blocked until a disposable repository and preview adapter are configured."
    }));
    return { pages: audits.length, issueCount };
  }
);
