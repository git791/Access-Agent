/** Best-effort operational alerting; the run record remains the source of truth. */
export async function alertRunFailure(runId: string, message: string) {
  const url = process.env.ACCESSAGENT_ALERT_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service: "AccessAgent", severity: "error", runId, message }) });
}
