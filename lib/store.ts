import { createClient } from "@supabase/supabase-js";
import type { Issue, Verdict } from "./contracts";
import { required } from "./config";

export type RunRecord = { id: string; targetUrl: string; status: "queued" | "auditing" | "patching" | "verifying" | "completed" | "needs_review" | "failed"; message: string; findings: Issue[]; evidence?: { before?: string; after?: string } };

function db() { return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY")); }

export async function createRun(run: RunRecord) {
  const { error } = await db().from("runs").insert({ id: run.id, target_url: run.targetUrl, status: run.status, message: run.message });
  if (error) throw error;
}

export async function updateRun(runId: string, patch: Partial<Pick<RunRecord, "status" | "message">>) {
  const { error } = await db().from("runs").update({ status: patch.status, message: patch.message, updated_at: new Date().toISOString() }).eq("id", runId);
  if (error) throw error;
}

export async function saveAudit(runId: string, pageUrl: string, screenshot: Buffer, issues: Issue[]) {
  const client = db(); const path = `${runId}/before-${Date.now()}.png`;
  const upload = await client.storage.from("evidence").upload(path, screenshot, { contentType: "image/png", upsert: false });
  if (upload.error) throw upload.error;
  const { data: publicUrl } = client.storage.from("evidence").getPublicUrl(path);
  const { error } = await client.from("findings").insert(issues.map((issue) => ({ run_id: runId, issue_id: issue.id, page_url: pageUrl, title: issue.title, wcag: issue.wcag, impact: issue.impact, helps: issue.helps, selector: issue.selector, status: issue.status, before_evidence_url: publicUrl.publicUrl })));
  if (error) throw error;
}

export async function getRun(runId: string): Promise<RunRecord | null> {
  const client = db(); const { data: run, error } = await client.from("runs").select("*").eq("id", runId).single();
  if (error || !run) return null;
  const { data: findings } = await client.from("findings").select("*").eq("run_id", runId);
  return { id: run.id, targetUrl: run.target_url, status: run.status, message: run.message, findings: (findings ?? []).map((f) => ({ id: f.issue_id, title: f.title, wcag: f.wcag, impact: f.impact, helps: f.helps, selector: f.selector ?? undefined, status: f.status })), evidence: { before: findings?.[0]?.before_evidence_url, after: findings?.[0]?.after_evidence_url } };
}

export async function markVerdict(runId: string, verdict: Verdict) {
  const status = verdict.resolved && !verdict.regression ? "Verified" : "Review";
  const { error } = await db().from("findings").update({ status, verification_note: verdict.explanation, after_evidence_url: verdict.afterScreenshotPath }).eq("run_id", runId).eq("issue_id", verdict.issueId);
  if (error) throw error;
}
