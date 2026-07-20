import { createClient } from "@supabase/supabase-js";
import type { Issue, Verdict } from "./contracts";
import { required } from "./config";

export type RunRecord = { id: string; targetUrl: string; ownerToken: string; userId?: string; status: "queued" | "auditing" | "patching" | "verifying" | "completed" | "needs_review" | "failed"; message: string; findings: Issue[]; patches?: { branch: string; commitSha?: string; attempt: number; filesChanged: string[]; diff: string }[]; evidence?: { before?: string; after?: string } };
export type PullRequestEvidence = { issueId: string; title: string; beforePath: string; afterPath: string; verificationNote?: string };

/** Server-only client. Its secret key bypasses RLS and must never reach browser code. */
function db() { return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SECRET_KEY")); }

export async function createRun(run: RunRecord) {
  const { error } = await db().from("runs").insert({ id: run.id, owner_token: run.ownerToken, user_id: run.userId, target_url: run.targetUrl, status: run.status, message: run.message });
  if (error) throw error;
  await appendEvent(run.id, "run.queued", run.message);
}

export async function updateRun(runId: string, patch: Partial<Pick<RunRecord, "status" | "message">>) {
  const { error } = await db().from("runs").update({ status: patch.status, message: patch.message, updated_at: new Date().toISOString() }).eq("id", runId);
  if (error) throw error;
  if (patch.message) await appendEvent(runId, `run.${patch.status ?? "updated"}`, patch.message);
}

export async function appendEvent(runId: string, kind: string, message: string) {
  const { error } = await db().from("run_events").insert({ run_id: runId, kind, message });
  if (error) throw error;
}

export async function saveAudit(runId: string, pageUrl: string, screenshot: Buffer, issues: Issue[]) {
  const client = db(); const path = `${runId}/before-${Date.now()}.png`;
  const upload = await client.storage.from("evidence").upload(path, screenshot, { contentType: "image/png", upsert: false });
  if (upload.error) throw upload.error;
  const { error } = await client.from("findings").insert(issues.map((issue) => ({ run_id: runId, issue_id: issue.id, page_url: pageUrl, title: issue.title, wcag: issue.wcag, impact: issue.impact, helps: issue.helps, selector: issue.selector, status: issue.status, before_evidence_url: path })));
  if (error) throw error;
  await appendEvent(runId, "audit.evidence_stored", `Stored rendered evidence for ${new URL(pageUrl).pathname || "/"}.`);
}

export async function getRun(runId: string, ownerToken: string, userId?: string): Promise<RunRecord | null> {
  const client = db(); let query = client.from("runs").select("*").eq("id", runId).eq("owner_token", ownerToken);
  if (userId) query = query.eq("user_id", userId);
  const { data: run, error } = await query.single();
  if (error || !run) return null;
  const { data: findings } = await client.from("findings").select("*").eq("run_id", runId);
  const { data: patches } = await client.from("patch_attempts").select("*").eq("run_id", runId).order("id");
  const signed = async (path?: string | null) => {
    if (!path) return undefined;
    const { data } = await client.storage.from("evidence").createSignedUrl(path, 60 * 15);
    return data?.signedUrl;
  };
  return { id: run.id, targetUrl: run.target_url, ownerToken: run.owner_token, userId: run.user_id ?? undefined, status: run.status, message: run.message, findings: (findings ?? []).map((f) => ({ id: f.issue_id, title: f.title, wcag: f.wcag, impact: f.impact, helps: f.helps, selector: f.selector ?? undefined, status: f.status })), patches: (patches ?? []).map((patch) => ({ branch: patch.branch, commitSha: patch.commit_sha ?? undefined, attempt: patch.attempt, filesChanged: patch.files_changed, diff: patch.diff })), evidence: { before: await signed(findings?.[0]?.before_evidence_url), after: await signed(findings?.[0]?.after_evidence_url) } };
}

export async function savePatches(runId: string, patches: { branch: string; commitSha?: string; attempt: number; filesChanged: string[]; diff: string }[]) {
  const { error } = await db().from("patch_attempts").insert(patches.map((patch) => ({ run_id: runId, branch: patch.branch, commit_sha: patch.commitSha, attempt: patch.attempt, files_changed: patch.filesChanged, diff: patch.diff })));
  if (error) throw error;
  await appendEvent(runId, "patch.diff_stored", `Stored diff for patch attempt ${patches[0]?.attempt}.`);
}

/** Returns only complete evidence pairs suitable for an explicitly consented PR upload. */
export async function verifiedPullRequestEvidence(runId: string, issueIds: string[]): Promise<PullRequestEvidence[]> {
  const { data, error } = await db().from("findings").select("issue_id, title, before_evidence_url, after_evidence_url, verification_note").eq("run_id", runId).in("issue_id", issueIds).eq("status", "Verified");
  if (error) throw error;
  const evidence = (data ?? []).flatMap((finding) => finding.before_evidence_url && finding.after_evidence_url ? [{ issueId: finding.issue_id, title: finding.title, beforePath: finding.before_evidence_url, afterPath: finding.after_evidence_url, verificationNote: finding.verification_note ?? undefined }] : []);
  if (evidence.length !== issueIds.length) throw new Error("A verified fix is missing a stored before/after evidence pair.");
  return evidence;
}

export async function readEvidenceFile(path: string) {
  const { data, error } = await db().storage.from("evidence").download(path);
  if (error || !data) throw error ?? new Error(`Evidence file could not be read: ${path}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function dueSchedules() {
  const { data, error } = await db().from("rescan_schedules").select("*").eq("enabled", true).lte("next_run_at", new Date().toISOString());
  if (error) throw error;
  return data ?? [];
}

export async function advanceSchedule(id: string) {
  const next = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error } = await db().from("rescan_schedules").update({ next_run_at: next }).eq("id", id);
  if (error) throw error;
}

export async function createRescanSchedule(targetUrl: string, ownerToken: string, userId: string | undefined, maxPages: number, maxDepth: number) {
  const client = db();
  const { data: existing, error: existingError } = await client.from("rescan_schedules")
    .select("id, target_url, enabled, next_run_at")
    .eq("owner_token", ownerToken)
    .eq("target_url", targetUrl)
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;
  const { data, error } = await client.from("rescan_schedules")
    .insert({ target_url: targetUrl, owner_token: ownerToken, user_id: userId, max_pages: maxPages, max_depth: maxDepth, next_run_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })
    .select("id, target_url, enabled, next_run_at")
    .single();
  if (error) throw error;
  return data;
}

export async function schedulesFor(ownerToken: string) {
  const { data, error } = await db().from("rescan_schedules").select("id, target_url, enabled, next_run_at, created_at").eq("owner_token", ownerToken).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function purgeExpiredRuns(retentionDays: number) {
  const client = db(); const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: runs, error } = await client.from("runs").select("id").lt("created_at", cutoff).limit(100);
  if (error) throw error;
  let purged = 0;
  for (const run of runs ?? []) {
    const { data: files, error: listError } = await client.storage.from("evidence").list(run.id, { limit: 1000 });
    if (listError) throw listError;
    if (files?.length) {
      const remove = await client.storage.from("evidence").remove(files.map((file) => `${run.id}/${file.name}`));
      if (remove.error) throw remove.error;
    }
    const { error: deleteError } = await client.from("runs").delete().eq("id", run.id);
    if (deleteError) throw deleteError;
    purged++;
  }
  return purged;
}

export async function eventsSince(runId: string, lastId = 0) {
  const { data, error } = await db().from("run_events").select("id, kind, message, created_at").eq("run_id", runId).gt("id", lastId).order("id");
  if (error) throw error;
  return data ?? [];
}

export async function markVerdict(runId: string, verdict: Verdict) {
  const status = verdict.resolved && !verdict.regression ? "Verified" : "Review";
  const { error } = await db().from("findings").update({ status, verification_note: verdict.explanation, after_evidence_url: verdict.afterScreenshotPath }).eq("run_id", runId).eq("issue_id", verdict.issueId);
  if (error) throw error;
}

export async function saveVerificationEvidence(runId: string, issueId: string, screenshot: Buffer) {
  const client = db(); const path = `${runId}/after-${issueId}-${Date.now()}.png`;
  const upload = await client.storage.from("evidence").upload(path, screenshot, { contentType: "image/png", upsert: false });
  if (upload.error) throw upload.error;
  return path;
}
