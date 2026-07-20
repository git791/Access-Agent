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
  const output = async (command: any) => {
    const [stdout, stderr] = await Promise.all([command.stdout(), command.stderr()]);
    return { stdout, stderr };
  };
  const run = async (command: { cmd: string; args: string[] }, label: string) => {
    const result = await sandbox.runCommand(command);
    if (result.exitCode !== 0) {
      const { stdout, stderr } = await output(result);
      throw new Error(`Sandbox ${label} failed: ${stderr || stdout || `exit code ${result.exitCode}`}`);
    }
    return result;
  };
  try {
    await run({ cmd: "git", args: ["clone", "--depth", "1", repository, "/vercel/sandbox/repo"] }, "clone");
    await run({ cmd: "git", args: ["-C", "/vercel/sandbox/repo", "checkout", "-b", branch] }, "branch creation");
    const inventory = await run({ cmd: "sh", args: ["-lc", "cd /vercel/sandbox/repo && find . -path './node_modules' -prune -o -type f \( -name '*.tsx' -o -name '*.ts' -o -name '*.jsx' -o -name '*.js' -o -name '*.css' \) -print | head -100"] }, "file inventory");
    const routeMap = await run({ cmd: "sh", args: ["-lc", "cd /vercel/sandbox/repo && { find app src/app pages src/pages -type f \( -name 'page.*' -o -name 'route.*' -o -name 'index.*' \) 2>/dev/null || true; } | head -100"] }, "route discovery");
    const terms = issues.flatMap((issue) => [issue.selector, new URL(issue.pageUrl ?? "http://localhost/").pathname.split("/").filter(Boolean).pop()]).filter(Boolean).map((term) => String(term).replace(/[^a-zA-Z0-9_-]/g, "")).filter((term) => term.length > 2).slice(0, 12);
    const locations = await run({ cmd: "sh", args: ["-lc", `cd /vercel/sandbox/repo && rg -n -i --glob '!node_modules/**' '${terms.join("|") || "a11y"}' . | head -120 || true`] }, "source search");
    const [inventoryOutput, routeMapOutput, locationsOutput] = await Promise.all([output(inventory), output(routeMap), output(locations)]);
    const prompt = `You are the patch role in a closed accessibility verification loop. Return JSON with exactly one field, "diff". Its value must be one unified git diff beginning with "diff --git", and nothing else. Make the smallest safe source-level fixes for these accessibility issues: ${JSON.stringify(issues)}. Framework route map: ${routeMapOutput.stdout}. Candidate files: ${inventoryOutput.stdout}. Source matches derived from the affected route/selector: ${locationsOutput.stdout}. First identify the route component matching each issue's pageUrl, then modify only the responsible component/style. Do not modify lockfiles, dependencies, generated files, dependencies, tests, or unrelated code. The diff must apply cleanly with git apply.`;
    const diff = await generatePatchDiff(prompt);
    if (!diff.startsWith("diff --git")) throw new Error("Patch role did not return a unified git diff.");
    const encoded = Buffer.from(diff).toString("base64");
    await run({ cmd: "sh", args: ["-lc", `echo ${encoded} | base64 -d > /tmp/accessagent.patch && cd /vercel/sandbox/repo && git apply --check /tmp/accessagent.patch && git apply /tmp/accessagent.patch && git diff --check`] }, "patch application");
    const testCommand = process.env.ACCESSAGENT_TEST_COMMAND;
    if (!testCommand) throw new Error("Missing required configuration: ACCESSAGENT_TEST_COMMAND");
    await run({ cmd: "sh", args: ["-lc", `cd /vercel/sandbox/repo && ${testCommand}`] }, "tests");
    // Capture this before committing: after a successful commit, `git diff` is empty.
    const changed = await run({ cmd: "git", args: ["-C", "/vercel/sandbox/repo", "diff", "--name-only"] }, "changed-file inspection");
    const { stdout: changedOutput } = await output(changed);
    const filesChanged = changedOutput.split("\n").map((line: string) => line.trim()).filter(Boolean);
    if (!filesChanged.length) throw new Error("Patch changed no source files after tests completed.");
    const token = required("GITHUB_TOKEN");
    await run({ cmd: "sh", args: ["-lc", `cd /vercel/sandbox/repo && git config user.name 'AccessAgent' && git config user.email 'accessagent@users.noreply.github.com' && git add -A && git commit -m 'fix(a11y): verified candidate batch' && git remote set-url origin https://x-access-token:${token}@github.com/${required("GITHUB_OWNER")}/${required("GITHUB_REPO")}.git && git push origin ${branch}`] }, "commit and push");
    const commit = await run({ cmd: "git", args: ["-C", "/vercel/sandbox/repo", "rev-parse", "HEAD"] }, "commit lookup");
    const { stdout: commitOutput } = await output(commit);
    return issues.map((issue) => ({ issueId: issue.id, branch, filesChanged, diff, attempt, commitSha: commitOutput.trim() }));
  } finally { await sandbox.stop(); }
}
