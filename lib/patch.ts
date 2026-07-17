import OpenAI from "openai";
import { required } from "./config";
import type { Issue, PatchHandoff } from "./contracts";

/**
 * Generates and tests a patch only inside a Vercel Sandbox. This adapter never
 * receives production database credentials and never operates on the local checkout.
 */
export async function proposeAndApplyPatch(issue: Issue): Promise<PatchHandoff> {
  const repository = required("ACCESSAGENT_REPO_URL");
  const client = new OpenAI({ apiKey: required("OPENAI_API_KEY") });
  const { Sandbox } = await import("@vercel/sandbox");
  const sandbox: any = await Sandbox.create({ runtime: "node22", timeout: 10 * 60 * 1000 });
  const branch = `accessagent/${issue.id}-${Date.now()}`.replace(/[^a-zA-Z0-9/_-]/g, "-");
  try {
    await sandbox.runCommand({ cmd: "git", args: ["clone", "--depth", "1", repository, "/vercel/sandbox/repo"] });
    await sandbox.runCommand({ cmd: "git", args: ["-C", "/vercel/sandbox/repo", "checkout", "-b", branch] });
    const inventory = await sandbox.runCommand({ cmd: "sh", args: ["-lc", "cd /vercel/sandbox/repo && find . -path './node_modules' -prune -o -type f \( -name '*.tsx' -o -name '*.ts' -o -name '*.jsx' -o -name '*.js' -o -name '*.css' \) -print | head -80"] });
    const prompt = `You are the patch role. Produce a unified git diff only, with the smallest safe source-level fix for this accessibility issue: ${JSON.stringify(issue)}. Candidate files: ${inventory.stdout}. Do not modify lockfiles, dependencies, or unrelated code. The diff must apply with git apply.`;
    const response = await client.responses.create({ model: process.env.OPENAI_PATCH_MODEL || "gpt-5.4", input: prompt });
    const diff = response.output_text.replace(/^```diff\s*|^```\s*|```$/gm, "").trim();
    if (!diff.startsWith("diff --git")) throw new Error("Patch role did not return a unified git diff.");
    const encoded = Buffer.from(diff).toString("base64");
    const apply = await sandbox.runCommand({ cmd: "sh", args: ["-lc", `echo ${encoded} | base64 -d > /tmp/accessagent.patch && cd /vercel/sandbox/repo && git apply --check /tmp/accessagent.patch && git apply /tmp/accessagent.patch && git diff --check`] });
    if (apply.exitCode !== 0) throw new Error(`Sandbox refused the patch: ${apply.stderr || apply.stdout}`);
    const changed = await sandbox.runCommand({ cmd: "git", args: ["-C", "/vercel/sandbox/repo", "diff", "--name-only"] });
    return { issueId: issue.id, branch, filesChanged: changed.stdout.split("\n").map((line: string) => line.trim()).filter(Boolean), diff, attempt: 1 };
  } finally { await sandbox.stop(); }
}
