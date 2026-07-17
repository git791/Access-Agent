"use client";

import { useEffect, useState } from "react";

type Finding = { id: string; title: string; wcag: string; impact: "Critical" | "Serious" | "Moderate"; helps: string; status: "Verified" | "Review" | "Found" };
type Run = { id: string; status: string; message: string; findings: Finding[]; evidence?: { before?: string; after?: string } };
const trace = ["Crawl + Audit", "Visual inspection", "Patch proposal", "Re-render", "Verification"];

export default function Home() {
  const [url, setUrl] = useState("http://localhost:3000");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("Ready. No finding is shown until a real audit produces it.");
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
  async function startAudit() {
    setRunning(true); setRun(null); setMessage("Requesting a real browser audit…");
    try {
      const response = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetUrl: url }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to start audit");
      setRun({ id: result.runId, status: "queued", message: result.message, findings: [] }); setMessage(result.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to start audit"); setRunning(false); }
  }
  const findings = run?.findings ?? [];
  const activeStep = run?.status === "auditing" ? 1 : run?.status === "patching" ? 2 : run?.status === "verifying" ? 4 : 0;
  return <main>
    <header className="topbar"><div className="brand"><span aria-hidden="true">⌖</span> AccessAgent</div><span className="chip contrast">Ink / Paper · 15.3:1 AAA</span><span className="status"><i /> {running ? "Run active" : "System ready"}</span></header>
    <section className="hero"><p className="eyebrow">RENDERED EXPERIENCE VERIFICATION</p><h1>Accessibility fixes that<br />look again before they claim success.</h1><p className="lede">AccessAgent audits a live preview, proposes a source-level patch, then re-renders and verifies the change with stored evidence.</p><div className="runbox"><label htmlFor="target">Preview URL</label><div className="urlrow"><input id="target" value={url} onChange={(event) => setUrl(event.target.value)} aria-describedby="audit-note" /><button onClick={startAudit} disabled={running}>{running ? "Inspecting…" : "Start verified audit"}</button></div><p id="audit-note" className="hint">Use a site you own or are authorized to test. {message}</p></div></section>
    <section className="board" aria-label="Current audit run"><div className="panel trace"><div className="section-title"><span>LIVE AGENT TRACE</span><span className="chip contrast">Navy / Paper · 9.8:1 AAA</span></div>{trace.map((step, index) => <div className={`trace-row ${running && index < activeStep ? "done" : running && index === activeStep ? "active" : ""}`} key={step}><span>{running && index < activeStep ? "✓" : index + 1}</span><div><strong>{step}</strong><small>{index === 0 ? "Screenshot + accessibility tree + axe baseline" : index === 1 ? "Judging the rendered experience" : index === 2 ? "Patch is allowed only in an isolated sandbox" : index === 3 ? "Fresh screenshot required" : "No claim without an evidence-backed verdict"}</small></div></div>)}</div><div className="panel evidence"><div className="section-title"><span>RENDER EVIDENCE</span><span className="reticle-label">{run?.evidence?.before ? "CAPTURED" : "AWAITING AUDIT"}</span></div>{run?.evidence?.before ? <><div className="screenshot real"><div className="corner tl"/><div className="corner tr"/><div className="corner bl"/><div className="corner br"/><img src={run.evidence.after || run.evidence.before} alt="Captured browser evidence from the selected preview" /></div><div className="evidence-meta"><span>{run.evidence.after ? "After render" : "Before render"}</span><span className="chip contrast">Stored evidence</span></div></> : <div className="empty-evidence">No screenshot is displayed until Playwright captures the selected page.</div>}</div></section>
    <section className="findings"><div className="section-title"><span>FINDINGS</span><span>{findings.length ? `${findings.length} browser-derived issues` : "No findings yet"}</span></div>{findings.length ? <div className="finding-grid">{findings.map((finding) => <article className="finding" key={finding.id}><div className="finding-top"><code>{finding.id}</code><span className={`chip ${finding.status.toLowerCase()}`}>{finding.status}</span></div><h3>{finding.title}</h3><p className="wcag">WCAG {finding.wcag}</p><p>{finding.helps}</p><footer><span className={`impact ${finding.impact.toLowerCase()}`}>{finding.impact} impact</span><span className="quiet">Evidence stored</span></footer></article>)}</div> : <div className="empty-findings">Start an authorized audit to populate this list. “Verified” is reserved for a completed re-render and verification verdict.</div>}</section>
  </main>;
}
