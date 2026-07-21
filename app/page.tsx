"use client";

import { FormEvent, useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type Finding = {
  id: string;
  title: string;
  wcag: string;
  impact: "Critical" | "Serious" | "Moderate";
  helps: string;
  status: "Verified" | "Review" | "Found";
};

type Patch = { branch: string; commitSha?: string; attempt: number; filesChanged: string[]; diff: string };
type Run = {
  id: string;
  status: string;
  message: string;
  findings: Finding[];
  patches?: Patch[];
  evidence?: { before?: string; after?: string };
  targetUrl?: string;
};
type Schedule = { id: string; target_url: string; enabled: boolean; next_run_at: string };

const terminalStatuses = ["completed", "needs_review", "failed"];
const trace = [
  { title: "Baseline audit", detail: "Capture the rendered page, accessibility tree, and deterministic findings." },
  { title: "Visual review", detail: "Check the interface a person encounters for barriers automated rules may miss." },
  { title: "Patch proposal", detail: "Prepare the smallest source-level change in an isolated branch." },
  { title: "Fresh render", detail: "Render the changed preview after tests and deployment checks pass." },
  { title: "Verification", detail: "Keep a success claim only when fresh evidence supports the fix." }
] as const;
const emptyMessage = "Start with a public preview URL, or try the live example for a guided walkthrough.";
const liveDemoUrl = "https://access-agent-sable.vercel.app/demo-target";

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

function explainAuditError(error?: string) {
  const raw = error?.trim() || "";
  const value = raw.toLowerCase();
  if (value.includes("live audits are unavailable") || value.includes("configuration is complete")) return "Auditing is not configured for this workspace yet. Ask a workspace administrator to finish setup.";
  if (value.includes("valid http") || value.includes("embedded credentials")) return "Use a complete public http:// or https:// URL without a username or password.";
  if (value.includes("private") || value.includes("reserved") || value.includes("localhost")) return "The audit worker cannot reach local or private URLs. Deploy a public preview, then try again.";
  if (value.includes("401") || value.includes("403") || value.includes("unauthorized") || value.includes("forbidden")) return "The preview refused access. Use an authorized public preview or check its access settings.";
  if (value.includes("timeout") || value.includes("network") || value.includes("econnrefused") || value.includes("enotfound")) return "The audit worker could not reach the preview. Check that it is online, public, and has a valid HTTPS certificate.";
  return raw || "The audit could not start. Check the preview URL and try again.";
}

export default function Home() {
  const [url, setUrl] = useState(liveDemoUrl);
  const [run, setRun] = useState<Run | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState(emptyMessage);
  const [events, setEvents] = useState<string[]>([]);
  const [queueFilter, setQueueFilter] = useState<"All" | "Critical" | "Review" | "Verified">("All");
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return;
    const client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    client.auth.getSession().then(({ data }) => setAccessToken(data.session?.access_token ?? null));
    const { data: listener } = client.auth.onAuthStateChange((_, session) => setAccessToken(session?.access_token ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  async function signOut() {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return;
    const client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    await client.auth.signOut();
  }

  useEffect(() => {
    if (!run || terminalStatuses.includes(run.status)) return;
    let cancelled = false;
    let failures = 0;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/runs/${run.id}`, { cache: "no-store" });
        const updated = await response.json().catch(() => null) as Run | null;
        if (!response.ok || !updated?.status) {
          failures += 1;
          if (failures >= 3 && !cancelled) { setRunning(false); setMessage("We stopped receiving audit updates. Your current results are still available; refresh or try again later."); }
          return;
        }
        if (cancelled) return;
        failures = 0;
        setRun(updated);
        setMessage(updated.status === "failed" ? explainAuditError(updated.message) : updated.message);
        if (terminalStatuses.includes(updated.status)) setRunning(false);
      } catch { failures += 1; }
    };
    const timer = window.setInterval(refresh, 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [run?.id, run?.status]);

  useEffect(() => {
    if (!run || terminalStatuses.includes(run.status)) return;
    const stream = new EventSource(`/api/runs/${run.id}/events`);
    stream.onmessage = (event) => {
      const item = JSON.parse(event.data) as { message: string };
      setEvents((current) => [...current.slice(-4), item.message]);
    };
    stream.onerror = () => stream.close();
    return () => stream.close();
  }, [run?.id, run?.status]);

  useEffect(() => {
    if (!run || run.status !== "completed") { setSchedules([]); return; }
    fetch(`/api/runs/${run.id}/schedule`).then(async (response) => response.ok ? response.json() : { schedules: [] }).then((result) => setSchedules(result.schedules ?? []));
  }, [run?.id, run?.status]);

  async function launchAudit(targetUrl: string) {
    if (!isHttpUrl(targetUrl)) { setMessage("Enter a valid public http(s) preview URL to start an audit."); return; }
    setRunning(true);
    setMessage("Starting a new audit. Your current workspace will remain visible until it is created.");
    setEvents([]);
    setScheduleMessage("");
    try {
      const response = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, body: JSON.stringify({ targetUrl }) });
      const result = await response.json().catch(() => ({})) as { runId?: string; message?: string; error?: string };
      if (!response.ok || !result.runId) throw new Error(explainAuditError(result.error));
      setRun({ id: result.runId, status: "queued", message: result.message || "Audit queued.", findings: [], targetUrl });
      setSelectedFinding(null);
      setQueueFilter("All");
      setMessage(result.message || "Audit queued.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to start audit."); setRunning(false); }
  }

  function startAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void launchAudit(url.trim());
  }

  async function scheduleRescan() {
    if (!run || schedules.length) return;
    const response = await fetch(`/api/runs/${run.id}/schedule`, { method: "POST" });
    const result = await response.json().catch(() => ({})) as { schedule?: Schedule; error?: string };
    if (!response.ok || !result.schedule) { setScheduleMessage(result.error || "Unable to schedule a rescan."); return; }
    setSchedules([result.schedule]);
    setScheduleMessage("Daily rescan scheduled. Your workspace administrator can manage this schedule.");
  }

  const findings = run?.findings ?? [];
  const reviewCount = findings.filter((finding) => finding.status === "Review").length;
  const verifiedCount = findings.filter((finding) => finding.status === "Verified").length;
  const priority = { Critical: 0, Serious: 1, Moderate: 2 };
  const statusPriority = { Review: 0, Found: 1, Verified: 2 };
  const visibleFindings = [...findings].sort((a, b) => priority[a.impact] - priority[b.impact] || statusPriority[a.status] - statusPriority[b.status]).filter((finding) => queueFilter === "All" || finding.impact === queueFilter || finding.status === queueFilter);
  const activeStep = run?.status === "auditing" ? 0 : run?.status === "patching" ? 2 : run?.status === "verifying" ? 3 : 0;
  const workflowState = run?.status === "completed" ? "Evidence reviewed" : run?.status === "needs_review" ? "Human decision needed" : run?.status === "failed" ? "Run needs attention" : run?.status === "verifying" ? "Fresh render in progress" : run?.status === "patching" ? "Patch evaluation in progress" : run?.status === "auditing" ? "Baseline inspection in progress" : "Waiting to begin";
  const isLiveDemo = run?.targetUrl === liveDemoUrl;
  const state = running ? "AUDIT RUNNING" : run?.status === "completed" ? "AUDIT COMPLETE" : run?.status === "needs_review" ? "DECISION NEEDED" : run?.status === "failed" ? "AUDIT FAILED" : "READY";
  const isError = /unable|could not|not configured|valid public|cannot reach|refused|failed/i.test(message);

  return <main className="dashboard" aria-busy={running}>
    <header className="topbar"><a className="brand" href="#audit-control" aria-label="PRGate home"><span className="brand-mark" aria-hidden="true">PR</span><span>PRGate</span></a><div className="topbar-meta">{accessToken ? <><span className="mono-chip">GITHUB CONNECTED</span><button type="button" className="text-button sign-out-button" onClick={() => void signOut()}>Sign out</button></> : <a className="github-button" href="/auth/login">Sign in with GitHub</a>}<span className={`system-chip ${running ? "running" : ""}`}><i aria-hidden="true" /> {state}</span><span className="mono-chip">AUDIT + REVIEW</span></div></header>

    <section className="welcome" aria-labelledby="workspace-heading"><div><p className="eyebrow">ACCESSIBILITY REMEDIATION WORKSPACE</p><h1 id="workspace-heading">Fix access.<br /><em>Keep the proof.</em></h1></div><p>Audit a public preview, focus on barriers with the greatest user impact, and keep the evidence behind every result.</p></section>

    <section className="operations-grid" aria-label="Start an accessibility audit"><section className="panel audit-card" id="audit-control" aria-labelledby="audit-heading"><div className="panel-heading"><div><p className="eyebrow" id="audit-heading">NEW AUDIT</p><h2>Choose a public preview</h2></div><span className="panel-state primary">SAFE BRANCH</span></div><p className="panel-intro">PRGate can propose changes only in a disposable branch. It never writes to your main branch, and it opens a pull request only after fresh verification succeeds.</p><form onSubmit={startAudit} noValidate><label htmlFor="target">Public preview URL</label><div className="input-row"><input id="target" name="target" type="url" inputMode="url" autoComplete="url" required spellCheck={false} placeholder="https://preview.example.com" value={url} onChange={(event) => setUrl(event.target.value)} aria-describedby="audit-note audit-expectations" /><button type="submit" disabled={running}>{running ? "STARTING…" : "START AUDIT"}</button></div></form><p className={`run-note ${isError ? "error" : ""}`} id="audit-note" role={isError ? "alert" : "status"} aria-live="polite">{message}</p><details className="audit-expectations" id="audit-expectations"><summary>Before you run</summary><ul><li>Use a preview you own or are authorized to test.</li><li>The worker needs a publicly reachable URL.</li><li>Sign in to save team-owned audit work and schedules.</li></ul></details></section>
      <section className="panel process-card" aria-labelledby="process-heading"><div className="panel-heading"><div><p className="eyebrow" id="process-heading">CURRENT STATUS</p><h2>{!run ? "No audit selected" : running ? "Audit in progress" : run.status === "needs_review" ? "Decision needed" : run.status === "failed" ? "Audit needs attention" : run.status === "completed" ? "Audit complete" : "Audit queued"}</h2></div><span className={`panel-state ${run?.status === "completed" ? "verified" : run?.status === "failed" ? "failed" : ""}`}>{!run ? "WAITING" : running ? "IN PROGRESS" : run.status === "needs_review" ? "REVIEW" : run.status === "completed" ? "COMPLETE" : run.status === "failed" ? "FAILED" : "QUEUED"}</span></div><p className="panel-intro">{!run ? "Start an audit to create a findings queue and captured evidence." : run.status === "needs_review" ? `${reviewCount} finding${reviewCount === 1 ? "" : "s"} need product or design intent before a safe change can be proposed.` : "We will keep the current run updated as it progresses."}</p><ol className="trace-list">{trace.map(({ title }, index) => { const done = run?.status === "completed" || (running && index < activeStep); const active = running && index === activeStep; return <li className={`${done ? "done" : ""} ${active ? "active" : ""}`} key={title} aria-current={active ? "step" : undefined}><span>{done ? "OK" : String(index + 1).padStart(2, "0")}</span><strong>{title}</strong>{active ? <em>Current</em> : null}{events[index] ? <small>{events[index]}</small> : null}</li>; })}</ol></section></section>

    {!run ? <section className="first-run panel" aria-labelledby="first-run-heading"><div><p className="eyebrow">LIVE EXAMPLE</p><h2 id="first-run-heading">See a real audit before connecting your own preview.</h2><p>PRGate will scan an intentionally flawed public storefront through the same audit workflow used for any public preview.</p></div><div className="first-run-actions"><button type="button" className="quiet" onClick={() => { setUrl(liveDemoUrl); void launchAudit(liveDemoUrl); }} disabled={running}>Try live example</button><button type="button" className="text-button" onClick={() => setUrl(liveDemoUrl)}>Use example URL</button></div></section> : <>
      {isLiveDemo ? <section className="demo-banner" role="status"><strong>LIVE EXAMPLE</strong><span>This is a real audit of a public example storefront. Results and evidence come from the current backend run.</span></section> : null}
      <section className="results-overview" aria-label="Audit results"><div className="results-heading"><p className="eyebrow">RESULTS / {run.id}</p><h2>Evidence and findings</h2><p>Review uncertain decisions first, then work through the remaining barriers in impact order.</p></div><div className="result-summary"><span>{findings.length} FINDINGS</span><span>{reviewCount ? `${reviewCount} NEED REVIEW` : verifiedCount ? `${verifiedCount} VERIFIED` : run.evidence?.before ? "BASELINE CAPTURED" : "CAPTURE PENDING"}</span></div></section>
      <section className="run-context" aria-label="Current audit context"><div><span>PREVIEW</span><strong title={run.targetUrl}>{run.targetUrl || "Not reported yet"}</strong></div><div><span>WORKFLOW</span><strong title={workflowState}>{workflowState}</strong></div><div><span>CAPTURE</span><strong>{run.evidence?.before ? "Browser evidence stored" : "Awaiting browser capture"}</strong></div></section>
      {run.status === "needs_review" ? <section className="review-callout" aria-labelledby="review-heading"><div><p className="eyebrow">HUMAN REVIEW REQUIRED</p><h2 id="review-heading">{reviewCount} decision{reviewCount === 1 ? "" : "s"} are blocking a safe change.</h2><p>Open each finding to review the impact and evidence status. Decisions are not made or persisted until a connected review workflow is available.</p></div><a href="#findings-heading">Review findings <span aria-hidden="true">→</span></a></section> : null}
      <section className="panel evidence-card" aria-labelledby="evidence-heading"><div className="panel-heading"><div><p className="eyebrow" id="evidence-heading">RENDER EVIDENCE</p><h2>{run.evidence?.before ? "Captured preview" : "Evidence is being captured"}</h2></div><span className={`panel-state ${run.evidence?.before ? "verified" : ""}`}>{run.evidence?.before ? "STORED" : "PENDING"}</span></div>{run.evidence?.before ? <div className="evidence-pair"><figure><img src={run.evidence.before} alt="Browser capture before the change" /><figcaption>Before render</figcaption></figure>{run.evidence.after ? <figure><img src={run.evidence.after} alt="Browser capture after the change" /><figcaption>Fresh render after the change</figcaption></figure> : null}</div> : <div className="empty-evidence compact"><span aria-hidden="true">[]</span><div><strong>No captured evidence yet.</strong><p>Browser captures appear here once the audit reaches the evidence stage.</p></div></div>}</section>
      <section className="panel findings-card" aria-labelledby="findings-heading"><div className="panel-heading"><div><p className="eyebrow" id="findings-heading">FINDINGS</p><h2>{findings.length} issue{findings.length === 1 ? "" : "s"} found</h2></div><span className="panel-state">{String(findings.length).padStart(2, "0")}</span></div><p className="panel-intro">Critical work and uncertain decisions rise to the top. Opening a finding never changes its status.</p>{findings.length ? <><div className="queue-toolbar" aria-label="Filter findings"><span>SHOW</span>{(["All", "Critical", "Review", "Verified"] as const).map((filter) => <button type="button" aria-pressed={queueFilter === filter} className={queueFilter === filter ? "selected" : ""} onClick={() => setQueueFilter(filter)} key={filter}>{filter}{filter === "Review" ? ` (${reviewCount})` : filter === "Verified" ? ` (${verifiedCount})` : ""}</button>)}<p aria-live="polite">{visibleFindings.length} of {findings.length} findings</p></div><div className="finding-grid">{visibleFindings.map((finding, index) => <article className={`finding ${index < 3 ? "priority" : ""}`} key={finding.id}><div><code>{finding.id}</code><span className={`finding-status ${finding.status.toLowerCase()}`}>{finding.status}</span></div><h3>{finding.title}</h3><p className="wcag">WCAG {finding.wcag}</p><p>{finding.helps}</p><footer><b className={finding.impact.toLowerCase()}>{finding.impact}</b><button type="button" onClick={() => setSelectedFinding(finding)}>View detail →</button></footer></article>)}</div></> : <div className="empty-findings compact"><span>WAITING FOR RESULTS</span><p>The findings queue will appear when the audit has completed its baseline.</p></div>}</section>
      {selectedFinding ? <section className="finding-detail panel" aria-labelledby="detail-heading" tabIndex={-1}><div className="panel-heading"><div><p className="eyebrow">FINDING DETAIL / {selectedFinding.id}</p><h2 id="detail-heading">{selectedFinding.title}</h2></div><button type="button" className="text-button" onClick={() => setSelectedFinding(null)}>Close</button></div><div className="detail-grid"><p><strong>Standard</strong>WCAG {selectedFinding.wcag}</p><p><strong>Impact</strong>{selectedFinding.impact}</p><p><strong>Review status</strong>{selectedFinding.status}</p></div><p>{selectedFinding.helps}</p><div className="detail-note"><strong>Evidence status</strong><span>{run.evidence?.before ? "Open the render evidence above to compare the captured page." : "Evidence has not been attached to this finding yet."}</span></div></section> : null}
      {run.status === "completed" ? <section className="panel integration-card" aria-labelledby="rescan-heading"><div className="panel-heading"><div><p className="eyebrow" id="rescan-heading">SCHEDULED RESCANS</p><h2>Keep this preview checked</h2></div>{!schedules.length ? <button className="quiet" type="button" onClick={scheduleRescan}>Schedule daily rescan</button> : null}</div>{scheduleMessage ? <p className="run-note">{scheduleMessage}</p> : null}{schedules.length ? <div className="schedule-list">{schedules.map((schedule) => <p key={schedule.id}>Daily audit of {schedule.target_url}; next run {new Date(schedule.next_run_at).toLocaleString()}.</p>)}</div> : <div className="empty-findings compact"><span>NOT SCHEDULED</span><p>Scheduling is available after a completed audit and can be managed by your workspace administrator.</p></div>}</section> : null}
      {run.patches?.length ? <section className="panel integration-card" aria-labelledby="patches-heading"><div className="panel-heading"><div><p className="eyebrow" id="patches-heading">PATCH RECORD</p><h2>Recorded patch attempts</h2></div><span className="panel-state">{run.patches.length}</span></div>{run.patches.map((patch) => <article className="patch-diff" key={`${patch.branch}-${patch.attempt}`}><header><p><code>{patch.branch}</code> · attempt {patch.attempt} · {patch.filesChanged.join(", ")}</p>{patch.commitSha ? <span>COMMIT · {patch.commitSha}</span> : null}</header><pre>{patch.diff}</pre></article>)}</section> : null}
    </>}
    {!run ? <section className="pre-run-workspace" aria-label="Audit workspace preview"><section className="results-overview"><div className="results-heading"><p className="eyebrow">RESULTS</p><h2>Evidence and findings will appear here</h2><p>Start an audit to create a prioritized queue and a durable browser-evidence record.</p></div><div className="result-summary"><span>NO RUN YET</span><span>SAFE BRANCH WORKFLOW</span></div></section><section className="panel evidence-card" aria-labelledby="empty-evidence-heading"><div className="panel-heading"><div><p className="eyebrow" id="empty-evidence-heading">03 / RENDER EVIDENCE</p><h2>Captured preview</h2></div><span className="panel-state">WAITING</span></div><div className="empty-evidence compact"><span aria-hidden="true">[]</span><div><strong>Baseline screenshots are stored with the run.</strong><p>They provide the before-and-after record needed to support a verification decision.</p></div></div></section><section className="panel findings-card" aria-labelledby="empty-findings-heading"><div className="panel-heading"><div><p className="eyebrow" id="empty-findings-heading">04 / PRIORITIZED FINDINGS</p><h2>Findings queue</h2></div><span className="panel-state">00</span></div><p className="panel-intro">Critical work and uncertain decisions rise to the top after the baseline is complete.</p><div className="empty-findings compact"><span>WAITING FOR RESULTS</span><p>Each finding will include its impact, WCAG reference, and the next safe action.</p></div></section></section> : null}
    <section className="method-details" aria-labelledby="method-heading"><div className="method-heading"><div><p className="eyebrow">THE CLOSED LOOP</p><h2 id="method-heading">How verification works</h2></div><p>Every stage leaves a record. A change is not called verified until a fresh rendered result supports it.</p></div><div className="guide-grid">{trace.map(({ title, detail }, index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{detail}</p></article>)}</div></section>
    <section className="verification-note"><div><p className="eyebrow">VERIFIED MEANS</p><h2>Not “a patch was written.”<br />A fresh render supports the fix.</h2></div><p>When evidence is inconclusive, PRGate should mark the issue for human review instead of turning uncertainty into a success claim.</p></section>
  </main>;
}
