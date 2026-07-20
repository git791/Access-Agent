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
    const applier = `const fs=require("fs"),path=require("path");const root="/vercel/sandbox/repo";const edits=JSON.parse(fs.readFileSync("/tmp/accessagent-edits.json","utf8")).edits;const escapeRe=value=>{let result="";for(const character of value){if("\\\\^$.*+?()[]{}|".includes(character))result+="\\\\";result+=character;}return result;};if(!Array.isArray(edits)||!edits.length)throw new Error("No edits supplied");for(const edit of edits){if(typeof edit.path!=="string"||typeof edit.oldText!=="string"||typeof edit.newText!=="string"||edit.path.startsWith("/")||edit.path.includes(".."))throw new Error("Invalid edit");const file=path.resolve(root,edit.path);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))throw new Error("Invalid file: "+edit.path);const source=fs.readFileSync(file,"utf8"),exactCount=source.split(edit.oldText).length-1;if(exactCount===1){fs.writeFileSync(file,source.replace(edit.oldText,edit.newText));continue;}const matcher=new RegExp(escapeRe(edit.oldText.trim()).replace(/\\s+/g,"\\\\s+"),"g"),matches=[...source.matchAll(matcher)];if(matches.length!==1)throw new Error("oldText must match exactly once in "+edit.path+"; exact "+exactCount+", whitespace-tolerant "+matches.length);const match=matches[0];fs.writeFileSync(file,source.slice(0,match.index)+edit.newText+source.slice(match.index+match[0].length));}`;
    const fallback = `const fs=require("fs"),path=require("path");const root="/vercel/sandbox/repo",issues=JSON.parse(fs.readFileSync("/tmp/accessagent-issues.json","utf8")).issues;const description=issues.map(issue=>String(issue.id)+" "+String(issue.title)+" "+String(issue.wcag)).join(" ").toLowerCase(),needsAlt=/image-alt|alternative text/.test(description),needsLabel=/label|form elements/.test(description),needsContrast=/contrast/.test(description),files=[];const visit=dir=>{if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const item=path.join(dir,entry.name);if(entry.isDirectory())visit(item);else if(/\\.(tsx|ts|jsx|js|css)$/.test(entry.name))files.push(item);}};["app","src/app","pages","src/pages"].forEach(dir=>visit(path.join(root,dir)));let changes=0;for(const file of files){let source=fs.readFileSync(file,"utf8"),updated=source;if(needsAlt)updated=updated.replace(/<img\\b[^>]*>/g,tag=>/\\balt\\s*=/.test(tag)?tag:tag.replace(/\\/?>(?=$)/,suffix=>" alt=\\\"\\\""+suffix));if(needsLabel)updated=updated.replace(/<(input|textarea)\\b[^>]*>/g,tag=>{if(/\\baria-label\\s*=/.test(tag)||/\\bid\\s*=/.test(tag))return tag;const placeholder=tag.match(/\\bplaceholder=(['\\\"])(.*?)\\1/);const label=placeholder?placeholder[2]:"Form field";return tag.replace(/\\/?>(?=$)/,suffix=>" aria-label=\\\""+label.replace(/\\\"/g,"&quot;")+"\\\""+suffix);});if(needsContrast)updated=updated.replace(/color:\\s*(['\\\"])#999\\1/g,"color: '#595959'");if(updated!==source){fs.writeFileSync(file,updated);changes++;}}if(!changes)throw new Error("No deterministic accessibility fix matched the audited findings");`;
    for (let generation = 1; generation <= 3; generation++) {
      const encodedEdits = Buffer.from(JSON.stringify({ edits })).toString("base64");
      const encodedApplier = Buffer.from(applier).toString("base64");
      const apply = await sandbox.runCommand({ cmd: "sh", args: ["-lc", `echo ${encodedEdits} | base64 -d > /tmp/accessagent-edits.json && echo ${encodedApplier} | base64 -d > /tmp/accessagent-apply.js && cd /vercel/sandbox/repo && node /tmp/accessagent-apply.js && git diff --check`] });
      if (apply.exitCode === 0) break;
      const { stdout, stderr } = await output(apply);
      lastPatchError = stderr || stdout || `exit code ${apply.exitCode}`;
      await run({ cmd: "sh", args: ["-lc", "cd /vercel/sandbox/repo && git reset --hard HEAD"] }, "patch rollback");
      if (generation === 3) {
        const encodedFallback = Buffer.from(fallback).toString("base64");
        const encodedIssues = Buffer.from(JSON.stringify({ issues })).toString("base64");
        await run({ cmd: "sh", args: ["-lc", `echo ${encodedFallback} | base64 -d > /tmp/accessagent-fallback.js && echo ${encodedIssues} | base64 -d > /tmp/accessagent-issues.json && cd /vercel/sandbox/repo && node /tmp/accessagent-fallback.js && git diff --check`] }, "deterministic accessibility fallback");
        break;
      }
      edits = await generatePatchEdits(`${prompt}\n\nThe previous edits were rejected by the sandbox: ${lastPatchError}\nReturn a newly generated complete replacement edit set. Do not explain it.`);
    }
    const generatedDiff = await run({ cmd: "git", args: ["-C", "/vercel/sandbox/repo", "diff", "--no-ext-diff"] }, "diff generation");
    const { stdout: diff } = await output(generatedDiff);
    if (!diff.startsWith("diff --git")) throw new Error("Patch edits changed no source files.");
    const testCommand = process.env.ACCESSAGENT_TEST_COMMAND;
    if (!testCommand) throw new Error("Missing required configuration: ACCESSAGENT_TEST_COMMAND");
    await run({ cmd: "sh", args: ["-lc", "cd /vercel/sandbox/repo && if [ -f package-lock.json ]; then npm ci --ignore-scripts; elif [ -f pnpm-lock.yaml ]; then corepack pnpm install --frozen-lockfile --ignore-scripts; elif [ -f yarn.lock ]; then corepack yarn install --immutable --ignore-scripts; else npm install --ignore-scripts; fi"] }, "dependency installation");
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
