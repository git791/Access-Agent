import { RetryAfterError } from "inngest";
import { inngest } from "./client";
import { crawlAndAudit } from "../lib/audit";
import { inspectRenderedPage, verifyRenderedFix } from "../lib/visual-audit";
import { advanceSchedule, createRun, dueSchedules, markVerdict, purgeExpiredRuns, saveAudit, savePatches, saveVerificationEvidence, updateRun, verifiedPullRequestEvidence } from "../lib/store";
import { alertRunFailure } from "../lib/alerts";
import { mergeAndPrioritize } from "../lib/prioritize";
import { proposeAndApplyPatch } from "../lib/patch";
import { waitForPreview } from "../lib/preview";
import { createVerifiedPullRequest } from "../lib/pr";
import type { Issue, Verdict } from "../lib/contracts";

type AuditEvent = { name: "accessagent/audit.requested"; data: { runId: string; targetUrl: string; maxPages: number; maxDepth: number } };
type AuditedPage = { url: string; screenshotBase64: string; accessibilityTree: string; issues: Issue[] };

function patchConfigured() {
  const required = ["ACCESSAGENT_REPO_URL", "ACCESSAGENT_TEST_COMMAND", "GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO", "VERCEL_TOKEN", "VERCEL_PROJECT_ID"];
  return process.env.ACCESSAGENT_PUBLISH_PR_EVIDENCE === "true" && required.every((key) => Boolean(process.env[key]));
}

function previewPage(previewBase: string, sourcePage: string) {
  const source = new URL(sourcePage); const preview = new URL(previewBase);
  preview.pathname = source.pathname; preview.search = source.search;
  return preview.toString();
}

const seriousOrCritical = (issue: Issue) => issue.impact === "Critical" || issue.impact === "Serious";

function providerRetryDelay(message: string): number | undefined {
  if (!/rate limit reached|tokens per (minute|day)|quota/i.test(message)) return undefined;
  const match = message.match(/try again in (?:(\d+)m)?([\d.]+)s/i);
  if (!match) return undefined;
  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2]);
  if (!Number.isFinite(seconds)) return undefined;
  // A small buffer prevents a retry at the exact edge of the provider window.
  return Math.max((minutes * 60 + seconds + 5) * 1_000, 15_000);
}

export const auditWorkflow = inngest.createFunction(
  { id: "audit-patch-verify", retries: 2 },
  { event: "accessagent/audit.requested" },
  async ({ event, step }) => {
    const data = (event as AuditEvent).data;
    try {
      await step.run("mark-auditing", () => updateRun(data.runId, { status: "auditing", message: "Capturing rendered pages and running axe-core." }));
      const rawPages = await step.run("crawl-and-static-audit", () => crawlAndAudit(data.targetUrl, data.maxPages, data.maxDepth));
      const pages = await Promise.all(rawPages.map((page) => step.run(`visual-audit-${new URL(page.url).pathname || "root"}`, async (): Promise<AuditedPage> => {
        const screenshot = Buffer.from(page.screenshotBase64, "base64");
        const visual = await inspectRenderedPage(screenshot, page.accessibilityTree, page.issues);
        const issues = mergeAndPrioritize(page.issues, visual);
        await saveAudit(data.runId, page.url, screenshot, issues);
        return { ...page, issues: issues.map((issue) => ({ ...issue, pageUrl: page.url })) };
      })));
      const candidates = pages.flatMap((page) => page.issues);
      if (!candidates.length) {
        await step.run("mark-completed-empty", () => updateRun(data.runId, { status: "completed", message: "Audit completed: no accessibility issues found." }));
        return { pages: pages.length, issueCount: 0 };
      }
      if (!patchConfigured()) {
        await step.run("mark-human-review", () => updateRun(data.runId, { status: "needs_review", message: "Audit completed. Patch/verify is waiting for repository, sandbox test, GitHub, Vercel preview, or PR-evidence publishing configuration." }));
        return { pages: pages.length, issueCount: candidates.length, status: "needs_review" };
      }
      const maxAttempts = Math.min(Math.max(Number(process.env.ACCESSAGENT_MAX_ATTEMPTS ?? 3), 1), 3);
      let finalBranch = ""; let verdicts: Verdict[] = [];
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await step.run(`mark-patching-${attempt}`, () => updateRun(data.runId, { status: "patching", message: `Applying and testing patch batch (attempt ${attempt}/${maxAttempts}).` }));
        const patches = await step.run(`sandbox-patch-${attempt}`, async () => { const result = await proposeAndApplyPatch(candidates, attempt); await savePatches(data.runId, result); return result; });
        finalBranch = patches[0]?.branch ?? "";
        const preview = await step.run(`wait-for-preview-${attempt}`, () => waitForPreview(finalBranch));
        await step.run(`mark-verifying-${attempt}`, () => updateRun(data.runId, { status: "verifying", message: `Re-rendering preview and verifying patch batch (attempt ${attempt}/${maxAttempts}).` }));
        verdicts = await Promise.all(candidates.map((issue) => step.run(`verify-${issue.id}-${attempt}`, async (): Promise<Verdict> => {
          const source = pages.find((page) => page.issues.some((candidate) => candidate.id === issue.id));
          if (!source) throw new Error(`Could not locate original evidence for ${issue.id}.`);
          const after = (await crawlAndAudit(previewPage(preview, source.url), 1, 0))[0];
          if (!after) throw new Error(`Preview did not render ${source.url}.`);
          const afterScreenshot = Buffer.from(after.screenshotBase64, "base64");
          const modelVerdict = await verifyRenderedFix(Buffer.from(source.screenshotBase64, "base64"), afterScreenshot, issue, after.accessibilityTree);
          const beforeKeys = new Set(source.issues.filter(seriousOrCritical).map((candidate) => `${candidate.wcag}:${candidate.selector ?? candidate.title}`));
          const newRegression = after.issues.filter(seriousOrCritical).some((candidate) => !beforeKeys.has(`${candidate.wcag}:${candidate.selector ?? candidate.title}`));
          const verdict = { ...modelVerdict, regression: modelVerdict.regression || newRegression, explanation: newRegression ? `${modelVerdict.explanation} A new serious or critical axe violation was also detected.` : modelVerdict.explanation };
          const afterPath = await saveVerificationEvidence(data.runId, issue.id, afterScreenshot);
          const complete: Verdict = { issueId: issue.id, ...verdict, afterScreenshotPath: afterPath };
          await markVerdict(data.runId, complete);
          return complete;
        })));
        if (verdicts.every((verdict) => verdict.resolved && !verdict.regression)) break;
      }
      const verified = candidates.filter((issue) => verdicts.some((verdict) => verdict.issueId === issue.id && verdict.resolved && !verdict.regression)).map((issue) => ({ ...issue, status: "Verified" as const }));
      if (verified.length !== candidates.length) {
        await step.run("mark-unverified-review", () => updateRun(data.runId, { status: "needs_review", message: "One or more patches could not be verified after the allowed attempts. No PR was created." }));
        return { pages: pages.length, issueCount: candidates.length, verified: verified.length, status: "needs_review" };
      }
      const evidence = await step.run("load-verified-pr-evidence", () => verifiedPullRequestEvidence(data.runId, verified.map((issue) => issue.id)));
      const pullRequest = await step.run("create-verified-pr", () => createVerifiedPullRequest(finalBranch, verified, data.runId, evidence));
      await step.run("mark-completed", () => updateRun(data.runId, { status: "completed", message: `All ${verified.length} fixes verified. Pull request #${pullRequest.data.number} created.` }));
      return { pages: pages.length, issueCount: candidates.length, verified: verified.length, pullRequest: pullRequest.data.html_url };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The audit failed unexpectedly.";
      const retryDelay = providerRetryDelay(message);
      if (retryDelay) {
        await updateRun(data.runId, { status: "queued", message: "AI provider rate limit reached. The audit will retry automatically after its quota window resets." });
        throw new RetryAfterError("AI provider rate limit reached; retry scheduled after the provider reset window.", retryDelay, { cause: error });
      }
      await updateRun(data.runId, { status: "failed", message });
      await alertRunFailure(data.runId, message).catch(() => undefined);
      throw error;
    }
  }
);

export const scheduledRescanWorkflow = inngest.createFunction(
  { id: "scheduled-rescan" },
  { cron: "0 2 * * *" },
  async ({ step }) => {
    const schedules = await step.run("load-due-rescans", dueSchedules);
    for (const schedule of schedules) {
      await step.run(`queue-${schedule.id}`, async () => {
        const runId = crypto.randomUUID();
        await createRun({ id: runId, ownerToken: schedule.owner_token, targetUrl: schedule.target_url, status: "queued", message: "Scheduled audit queued.", findings: [] });
        await inngest.send({ name: "accessagent/audit.requested", data: { runId, targetUrl: schedule.target_url, maxPages: schedule.max_pages, maxDepth: schedule.max_depth } });
        await advanceSchedule(schedule.id);
      });
    }
    return { queued: schedules.length };
  }
);

export const retentionCleanupWorkflow = inngest.createFunction(
  { id: "retention-cleanup" },
  { cron: "30 2 * * *" },
  async ({ step }) => {
    const days = Math.max(Number(process.env.ACCESSAGENT_RETENTION_DAYS ?? 30), 1);
    const purged = await step.run("purge-expired-runs-and-evidence", () => purgeExpiredRuns(days));
    return { purged, retentionDays: days };
  }
);
