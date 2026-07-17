import { Octokit } from "octokit";
import { required } from "./config";
import type { Issue } from "./contracts";

export async function createVerifiedPullRequest(branch: string, fixes: Issue[]) {
  if (!fixes.length || fixes.some((fix) => fix.status !== "Verified")) throw new Error("A pull request may contain verified fixes only.");
  const octokit = new Octokit({ auth: required("GITHUB_TOKEN") });
  const owner = required("GITHUB_OWNER"); const repo = required("GITHUB_REPO");
  const body = fixes.map((fix) => `- **${fix.title}** — WCAG ${fix.wcag}\n  - Helps: ${fix.helps}\n  - Verification evidence is stored with the AccessAgent run.`).join("\n");
  return octokit.rest.pulls.create({ owner, repo, head: branch, base: process.env.GITHUB_BASE_BRANCH || "main", title: `fix(a11y): ${fixes.length} verified accessibility improvement${fixes.length === 1 ? "" : "s"}`, body: `## AccessAgent verified fixes\n\n${body}\n\nOnly fixes with a before/after rendered verification verdict are included.` });
}
