import { required } from "./config";
import { generatePatchDiff } from "./ai-provider";
import type { Issue, PatchHandoff } from "./contracts";

/**
 * Generates and tests a patch only inside a Vercel Sandbox. This adapter never
 * receives production database credentials and never operates on the local checkout.
 */
export async function proposeAndApplyPatch(issues: Issue[], attempt = 1): Promise<PatchHandoff[]> {
  if (!issues.length) throw new Error("Cannot patch an empty issue set.");
  const repository = required("ACCESSAGENT_REPO_URL");
  const { Sandbox } = await import("@vercel/sandbox");
  // Vercel provides OIDC automatically when this runs there. Render (and local
  // workers) authenticate with this existing project-scoped access token instead.
  const sandboxCredentials = process.env.VERCEL_OIDC_TOKEN ? {} : {
    teamId: required("VERCEL_TEAM_ID"),
    projectId: required("VERCEL_PROJECT_ID"),
    token: required("VERCEL_TOKEN")
  };
  const sandbox: any = await Sandbox.create({ runtime: "node22", timeout: 10 * 60 * 1000, ...sandboxCredentials });
  const branch = `accessagent/run-${Date.now()}-attempt-${attempt}`.replace(/[^a-zA-Z0-9/_-]/g, "-");
  try {
    await sandbox.runCommand({ cmd: "git", args: ["clone", "--depth", "1", repository, "/vercel/sandbox/repo"] });
    await sandbox.runCommand({ cmd: "git", args: ["-C", "/vercel/sandbox/repo", "checkout", "-b", branch] });
    const inventory = await sandbox.runCommand({ cmd: "sh", args: ["-lc", "cd /vercel/sandbox/repo && find . -path './node_modules' -prune -o -type f \( -name '*.tsx' -o -name '*.ts' -o -name '*.jsx' -o -name '*.js' -o -name '*.css' \) -print | head -100"] });
    const routeMap = await sandbox.runCommand({ cmd: "sh", args: ["-lc", "cd /vercel/sandbox/repo && { find app src/app pages src/pages -type f \( -name 'page.*' -o -name 'route.*' -o -name 'index.*' \) 2>/dev/null || true; } | head -100"] });
    const terms = issues.flatMap((issue) => [issue.selector, new URL(issue.pageUrl ?? "http://localhost/").pathname.split("/").filter(Boolean).pop()]).filter(Boolean).map((term) => String(term).replace(/[^a-zA-Z0-9_-]/g, "")).filter((term) => term.length > 2).slice(0, 12);
    const locations = await sandbox.runCommand({ cmd: "sh", args: ["-lc", `cd /vercel/sandbox/repo && rg -n -i --glob '!node_modules/**' '${terms.join("|") || "a11y"}' . | head -120 || true`] });
    const prompt = `You are the patch role in a closed accessibility verification loop. Return JSON with exactly one field, "diff". Its value must be one unified git diff beginning with "diff --git", and nothing else. Make the smallest safe source-level fixes for these accessibility issues: ${JSON.stringify(issues)}. Framework route map: ${routeMap.stdout}. Candidate files: ${inventory.stdout}. Source matches derived from the affected route/selector: ${locations.stdout}. First identify the route component matching each issue's pageUrl, then modify only the responsible component/style. Do not modify lockfiles, dependencies, generated files, dependencies, tests, or unrelated code. The diff must apply cleanly with git apply.`;
    const diff = await generatePatchDiff(prompt);
    if (!diff.startsWith("diff --git")) throw new Error("Patch role did not return a unified git diff.");
    const encoded = Buffer.from(diff).toString("base64");
    const apply = await sandbox.runCommand({ cmd: "sh", args: ["-lc", `echo ${encoded} | base64 -d > /tmp/accessagent.patch && cd /vercel/sandbox/repo && git apply --check /tmp/accessagent.patch && git apply /tmp/accessagent.patch && git diff --check`] });
    if (apply.exitCode !== 0) throw new Error(`Sandbox refused the patch: ${apply.stderr || apply.stdout}`);
    const testCommand = process.env.ACCESSAGENT_TEST_COMMAND;
    if (!testCommand) throw new Error("Missing required configuration: ACCESSAGENT_TEST_COMMAND");
    const test = await sandbox.runCommand({ cmd: "sh", args: ["-lc", `cd /vercel/sandbox/repo && ${testCommand}`] });
    if (test.exitCode !== 0) throw new Error(`Sandbox tests failed: ${test.stderr || test.stdout}`);
    // Capture this before committing: after a successful commit, `git diff` is empty.
    const changed = await sandbox.runCommand({ cmd: "git", args: ["-C", "/vercel/sandbox/repo", "diff", "--name-only"] });
    const filesChanged = changed.stdout.split("\n").map((line: string) => line.trim()).filter(Boolean);
    if (!filesChanged.length) throw new Error("Patch changed no source files after tests completed.");
    const token = required("GITHUB_TOKEN");
    await sandbox.runCommand({ cmd: "sh", args: ["-lc", `cd /vercel/sandbox/repo && git config user.name 'AccessAgent' && git config user.email 'accessagent@users.noreply.github.com' && git add -A && git commit -m 'fix(a11y): verified candidate batch' && git remote set-url origin https://x-access-token:${token}@github.com/${required("GITHUB_OWNER")}/${required("GITHUB_REPO")}.git && git push origin ${branch}`] });
    const commit = await sandbox.runCommand({ cmd: "git", args: ["-C", "/vercel/sandbox/repo", "rev-parse", "HEAD"] });
    return issues.map((issue) => ({ issueId: issue.id, branch, filesChanged, diff, attempt, commitSha: commit.stdout.trim() }));
  } finally { await sandbox.stop(); }
}
