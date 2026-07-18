"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type Finding = { id: string; title: string; wcag: string; impact: "Critical" | "Serious" | "Moderate"; helps: string; status: "Verified" | "Review" | "Found" };
type Run = { id: string; status: string; message: string; findings: Finding[]; patches?: { branch: string; commitSha?: string; attempt: number; filesChanged: string[]; diff: string }[]; evidence?: { before?: string; after?: string } };
type Schedule = { id: string; target_url: string; enabled: boolean; next_run_at: string };
const trace = ["Crawl + Audit", "Visual inspection", "Patch proposal", "Re-render", "Verification"];

export default function Home() {
  const [url, setUrl] = useState("http://localhost:3000");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("Ready. No finding is shown until a real audit produces it.");
  const [events, setEvents] = useState<string[]>([]);
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
  const [run, setRun] = useState<Run | null>(null);
  useEffect(() => {
    if (!run || ["completed", "needs_review", "failed"].includes(run.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/runs/${run.id}`);
      if (!response.ok) return;
      const updated = await response.json() as Run;
      setRun(updated); setMessage(updated.message);
      if (["completed", "needs_review", "failed"].includes(updated.status)) setRunning(false);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [run]);
  useEffect(() => {
    if (!run) return;
    const stream = new EventSource(`/api/runs/${run.id}/events`);
    stream.onmessage = (event) => { const item = JSON.parse(event.data) as { message: string }; setEvents((current) => [...current.slice(-4), item.message]); };
    stream.onerror = () => stream.close();
    return () => stream.close();
  }, [run?.id]);
  useEffect(() => {
    if (!run) return;
    fetch(`/api/runs/${run.id}/schedule`).then(async (response) => response.ok ? response.json() : { schedules: [] }).then((result) => setSchedules(result.schedules ?? []));
  }, [run?.id]);
  async function startAudit() {
    setRunning(true); setRun(null); setEvents([]); setMessage("Requesting a real browser audit...");
    try {
      const response = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, body: JSON.stringify({ targetUrl: url }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to start audit");
      setRun({ id: result.runId, status: "queued", message: result.message, findings: [] }); setMessage(result.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to start audit"); setRunning(false); }
  }
  async function scheduleRescan() {
    if (!run) return;
    const response = await fetch(`/api/runs/${run.id}/schedule`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) { setScheduleMessage(result.error || "Unable to schedule rescan."); return; }
    setSchedules((current) => [result.schedule, ...current]); setScheduleMessage("Daily rescan scheduled.");
  }
  const findings = run?.findings ?? [];
  const activeStep = run?.status === "auditing" ? 1 : run?.status === "patching" ? 2 : run?.status === "verifying" ? 4 : 0;
  return <main>
    <header className="topbar"><div className="brand"><span aria-hidden="true">[+]</span> AccessAgent</div><span className="chip contrast">Ink / Paper · 15.3:1 AAA</span>{!accessToken && process.env.NEXT_PUBLIC_SUPABASE_URL ? <a className="quiet" href="/auth/login">Sign in with GitHub</a> : null}<span className="status"><i /> {running ? "Run active" : "System ready"}</span></header>
    <section className="hero"><p className="eyebrow">RENDERED EXPERIENCE VERIFICATION</p><h1>Accessibility fixes that<br />look again before they claim success.</h1><p className="lede">AccessAgent audits a live preview, proposes a source-level patch, then re-renders and verifies the change with stored evidence.</p><div className="runbox"><label htmlFor="target">Preview URL</label><div className="urlrow"><input id="target" value={url} onChange={(event) => setUrl(event.target.value)} aria-describedby="audit-note" /><button onClick={startAudit} disabled={running}>{running ? "Inspecting..." : "Start verified audit"}</button></div><p id="audit-note" className="hint">Use a site you own or are authorized to test. {message}</p></div></section>
    <section className="board" aria-label="Current audit run"><div className="panel trace"><div className="section-title"><span>LIVE AGENT TRACE</span><span className="chip contrast">Navy / Paper · 9.8:1 AAA</span></div>{trace.map((step, index) => <div className={`trace-row ${running && index < activeStep ? "done" : running && index === activeStep ? "active" : ""}`} key={step}><span>{running && index < activeStep ? "OK" : index + 1}</span><div><strong>{step}</strong><small>{events[index] ?? (index === 0 ? "Waiting for a real browser audit." : "Awaiting this workflow stage.")}</small></div></div>)}</div><div className="panel evidence"><div className="section-title"><span>RENDER EVIDENCE</span><span className="reticle-label">{run?.evidence?.before ? "CAPTURED" : "AWAITING AUDIT"}</span></div>{run?.evidence?.before ? <><div className="screenshot real"><div className="corner tl"/><div className="corner tr"/><div className="corner bl"/><div className="corner br"/><img src={run.evidence.after || run.evidence.before} alt="Captured browser evidence from the selected preview" /></div><div className="evidence-meta"><span>{run.evidence.after ? "After render" : "Before render"}</span><span className="chip contrast">Stored evidence</span></div></> : <div className="empty-evidence">No screenshot is displayed until Playwright captures the selected page.</div>}</div></section>
    {run?.evidence?.before && run.evidence.after ? <section className="findings"><div className="section-title"><span>BEFORE / AFTER</span><span>Rendered verification evidence</span></div><div className="evidence-pair"><figure><img src={run.evidence.before} alt="Before patch browser evidence" /><figcaption>Before patch</figcaption></figure><figure><img src={run.evidence.after} alt="After patch browser evidence" /><figcaption>After patch</figcaption></figure></div></section> : null}
    <section className="findings"><div className="section-title"><span>FINDINGS</span><span>{findings.length ? `${findings.length} browser-derived issues` : "No findings yet"}</span></div>{findings.length ? <div className="finding-grid">{findings.map((finding) => <article className="finding" key={finding.id}><div className="finding-top"><code>{finding.id}</code><span className={`chip ${finding.status.toLowerCase()}`}>{finding.status}</span></div><h3>{finding.title}</h3><p className="wcag">WCAG {finding.wcag}</p><p>{finding.helps}</p><footer><span className={`impact ${finding.impact.toLowerCase()}`}>{finding.impact} impact</span><span className="quiet">Evidence stored</span></footer></article>)}</div> : <div className="empty-findings">Start an authorized audit to populate this list. Verified is reserved for a completed re-render and verification verdict.</div>}</section>
    {run ? <section className="findings"><div className="section-title"><span>SCHEDULED RESCANS</span><button className="quiet" onClick={scheduleRescan}>Schedule daily rescan</button></div>{scheduleMessage ? <p className="hint">{scheduleMessage}</p> : null}{schedules.length ? <div className="schedule-list">{schedules.map((schedule) => <p key={schedule.id}>Daily audit of {schedule.target_url}; next run {new Date(schedule.next_run_at).toLocaleString()}.</p>)}</div> : <div className="empty-findings">No rescan is scheduled for this audit yet.</div>}</section> : null}
    {run?.patches?.length ? <section className="findings"><div className="section-title"><span>PATCH DIFFS</span><span>{run.patches.length} stored attempt(s)</span></div>{run.patches.map((patch) => <article className="patch-diff" key={`${patch.branch}-${patch.attempt}`}><p><code>{patch.branch}</code> · attempt {patch.attempt} · {patch.filesChanged.join(", ")}</p><pre>{patch.diff}</pre></article>)}</section> : null}
  </main>;
}
