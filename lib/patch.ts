import { required } from "./config";
import { generatePatchEdits } from "./ai-provider";
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
    const inventory = await run({ cmd: "sh", args: ["-lc", "cd /vercel/sandbox/repo && find . -path './node_modules' -prune -o -type f \\( -name '*.tsx' -o -name '*.ts' -o -name '*.jsx' -o -name '*.js' -o -name '*.css' \\) -print | head -100"] }, "file inventory");
    const routeMap = await run({ cmd: "sh", args: ["-lc", "cd /vercel/sandbox/repo && { find app src/app pages src/pages -type f \\( -name 'page.*' -o -name 'route.*' -o -name 'index.*' \\) 2>/dev/null || true; } | head -100"] }, "route discovery");
    const terms = issues.flatMap((issue) => [issue.selector, new URL(issue.pageUrl ?? "http://localhost/").pathname.split("/").filter(Boolean).pop()]).filter(Boolean).map((term) => String(term).replace(/[^a-zA-Z0-9_-]/g, "")).filter((term) => term.length > 2).slice(0, 12);
    const locations = await run({ cmd: "sh", args: ["-lc", `cd /vercel/sandbox/repo && rg -n -i --glob '!node_modules/**' '${terms.join("|") || "a11y"}' . | head -120 || true`] }, "source search");
    const sourceExcerpt = await run({ cmd: "sh", args: ["-lc", `cd /vercel/sandbox/repo && { rg -l -i --glob '!node_modules/**' '${terms.join("|") || "a11y"}' . || true; } | head -8 | while IFS= read -r file; do printf '\n--- %s ---\n' "$file"; sed -n '1,240p' "$file"; done`] }, "source excerpt collection");
    const [inventoryOutput, routeMapOutput, locationsOutput, sourceExcerptOutput] = await Promise.all([output(inventory), output(routeMap), output(locations), output(sourceExcerpt)]);
    const prompt = `You are the patch role in a closed accessibility verification loop. Return JSON with exactly one field, "edits". Each edit must contain a repository-relative path, an exact oldText copied character-for-character from that file, and its replacement newText. Make the smallest safe source-level fixes for these accessibility issues: ${JSON.stringify(issues)}. Framework route map: ${routeMapOutput.stdout}. Candidate files: ${inventoryOutput.stdout}. Source matches derived from the affected route/selector: ${locationsOutput.stdout}. Relevant source excerpts: ${sourceExcerptOutput.stdout}. First identify the route component matching each issue's pageUrl, then modify only the responsible component/style. Do not modify lockfiles, dependencies, generated files, dependencies, tests, or unrelated code. Each oldText must match exactly once.`;
    let edits = await generatePatchEdits(prompt);
    let lastPatchError = "";
    const applier = `const fs=require("fs"),path=require("path");const root="/vercel/sandbox/repo";const edits=JSON.parse(fs.readFileSync("/tmp/accessagent-edits.json","utf8")).edits;if(!Array.isArray(edits)||!edits.length)throw new Error("No edits supplied");for(const edit of edits){if(typeof edit.path!=="string"||typeof edit.oldText!=="string"||typeof edit.newText!=="string"||edit.path.startsWith("/")||edit.path.includes(".."))throw new Error("Invalid edit");const file=path.resolve(root,edit.path);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))throw new Error("Invalid file: "+edit.path);const source=fs.readFileSync(file,"utf8"),count=source.split(edit.oldText).length-1;if(count!==1)throw new Error("oldText must match exactly once in "+edit.path+"; matched "+count);fs.writeFileSync(file,source.replace(edit.oldText,edit.newText));}`;
    for (let generation = 1; generation <= 2; generation++) {
      const encodedEdits = Buffer.from(JSON.stringify({ edits })).toString("base64");
      const encodedApplier = Buffer.from(applier).toString("base64");
      const apply = await sandbox.runCommand({ cmd: "sh", args: ["-lc", `echo ${encodedEdits} | base64 -d > /tmp/accessagent-edits.json && echo ${encodedApplier} | base64 -d > /tmp/accessagent-apply.js && cd /vercel/sandbox/repo && node /tmp/accessagent-apply.js && git diff --check`] });
      if (apply.exitCode === 0) break;
      const { stdout, stderr } = await output(apply);
      lastPatchError = stderr || stdout || `exit code ${apply.exitCode}`;
      await run({ cmd: "sh", args: ["-lc", "cd /vercel/sandbox/repo && git reset --hard HEAD"] }, "patch rollback");
      if (generation === 2) throw new Error(`Patch model produced non-applicable source edits after two attempts: ${lastPatchError}`);
      edits = await generatePatchEdits(`${prompt}\n\nThe previous edits were rejected by the sandbox: ${lastPatchError}\nReturn a newly generated complete replacement edit set. Do not explain it.`);
    }
    const generatedDiff = await run({ cmd: "git", args: ["-C", "/vercel/sandbox/repo", "diff", "--no-ext-diff"] }, "diff generation");
    const { stdout: diff } = await output(generatedDiff);
    if (!diff.startsWith("diff --git")) throw new Error("Patch edits changed no source files.");
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
