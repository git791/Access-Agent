import { Octokit } from "octokit";
import { required } from "./config";
import type { Issue } from "./contracts";
import { readEvidenceFile, type PullRequestEvidence } from "./store";

function safePathSegment(value: string) { return value.replace(/[^a-zA-Z0-9._-]/g, "-"); }

async function uploadEvidence(octokit: Octokit, owner: string, repo: string, branch: string, runId: string, evidence: PullRequestEvidence[]) {
  const base = `.accessagent/evidence/${safePathSegment(runId)}`;
  const imageUrls = new Map<string, { before: string; after: string }>();
  for (const item of evidence) {
    const issue = safePathSegment(item.issueId);
    const paths = { before: `${base}/${issue}-before.png`, after: `${base}/${issue}-after.png` };
    const [before, after] = await Promise.all([readEvidenceFile(item.beforePath), readEvidenceFile(item.afterPath)]);
    await octokit.rest.repos.createOrUpdateFileContents({ owner, repo, branch, path: paths.before, message: `docs(a11y): add before evidence for ${item.issueId}`, content: before.toString("base64") });
    await octokit.rest.repos.createOrUpdateFileContents({ owner, repo, branch, path: paths.after, message: `docs(a11y): add after evidence for ${item.issueId}`, content: after.toString("base64") });
    imageUrls.set(item.issueId, {
      before: `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${paths.before}?raw=1`,
      after: `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${paths.after}?raw=1`,
    });
  }
  return imageUrls;
}

export async function createVerifiedPullRequest(branch: string, fixes: Issue[], runId: string, evidence: PullRequestEvidence[]) {
  if (!fixes.length || fixes.some((fix) => fix.status !== "Verified")) throw new Error("A pull request may contain verified fixes only.");
  if (process.env.ACCESSAGENT_PUBLISH_PR_EVIDENCE !== "true") throw new Error("Set ACCESSAGENT_PUBLISH_PR_EVIDENCE=true to explicitly permit PR screenshot uploads.");
  const octokit = new Octokit({ auth: required("GITHUB_TOKEN") });
  const owner = required("GITHUB_OWNER"); const repo = required("GITHUB_REPO");
  const imageUrls = await uploadEvidence(octokit, owner, repo, branch, runId, evidence);
  const body = fixes.map((fix) => {
    const images = imageUrls.get(fix.id);
    if (!images) throw new Error(`Missing uploaded evidence for ${fix.id}.`);
    return `- **${fix.title}** — WCAG ${fix.wcag}\n  - Helps: ${fix.helps}\n  - Before: ![Before verification](${images.before})\n  - After: ![After verification](${images.after})`;
  }).join("\n\n");
  return octokit.rest.pulls.create({ owner, repo, head: branch, base: process.env.GITHUB_BASE_BRANCH || "main", title: `fix(a11y): ${fixes.length} verified accessibility improvement${fixes.length === 1 ? "" : "s"}`, body: `## AccessAgent verified fixes\n\n${body}\n\nOnly fixes with a before/after rendered verification verdict are included.` });
}
