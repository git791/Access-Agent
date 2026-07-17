"use client";

import { useState } from "react";

type Finding = { id: string; title: string; wcag: string; impact: "Critical" | "Serious" | "Moderate"; helps: string; status: "Verified" | "Review" | "Found" };

const initialFindings: Finding[] = [
  { id: "AA-014", title: "Checkout button has insufficient contrast", wcag: "1.4.3 Contrast (Minimum)", impact: "Serious", helps: "People with low vision distinguish the primary action.", status: "Verified" },
  { id: "AA-021", title: "Email field has no programmatic label", wcag: "1.3.1 Info and Relationships", impact: "Critical", helps: "Screen-reader users know what information to enter.", status: "Found" },
  { id: "AA-032", title: "Modal focus escapes to page content", wcag: "2.4.3 Focus Order", impact: "Critical", helps: "Keyboard and switch users can complete the dialog task.", status: "Review" }
];

const trace = ["Crawl + Audit", "Visual inspection", "Patch proposal", "Re-render", "Verification"];

export default function Home() {
  const [url, setUrl] = useState("http://localhost:3000/demo-target");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("Ready to inspect a controlled preview.");
  const [findings, setFindings] = useState(initialFindings);

  async function startAudit() {
    setRunning(true); setMessage("Capturing a fresh render and running the baseline audit…");
    try {
      const response = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetUrl: url }) });
      const run = await response.json();
      if (!response.ok) throw new Error(run.error || "Unable to start audit");
      if (run.findings?.length) setFindings(run.findings);
      setMessage(run.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to start audit"); }
    finally { setRunning(false); }
  }

  return <main>
    <header className="topbar"><div className="brand"><span aria-hidden="true">⌖</span> AccessAgent</div><span className="chip contrast">Ink / Paper · 15.3:1 AAA</span><span className="status"><i /> System ready</span></header>
    <section className="hero"><p className="eyebrow">RENDERED EXPERIENCE VERIFICATION</p><h1>Accessibility fixes that<br />look again before they claim success.</h1><p className="lede">AccessAgent audits a live preview, proposes a source-level patch, then re-renders and verifies the change with stored evidence.</p>
      <div className="runbox"><label htmlFor="target">Preview URL</label><div className="urlrow"><input id="target" value={url} onChange={(event) => setUrl(event.target.value)} aria-describedby="audit-note" /><button onClick={startAudit} disabled={running}>{running ? "Inspecting…" : "Start verified audit"}</button></div><p id="audit-note" className="hint">Use a site you own or are authorized to test. {message}</p></div>
    </section>
    <section className="board" aria-label="Current audit run"><div className="panel trace"><div className="section-title"><span>LIVE AGENT TRACE</span><span className="chip contrast">Navy / Paper · 9.8:1 AAA</span></div>{trace.map((step, index) => <div className={`trace-row ${index < 2 ? "done" : index === 2 ? "active" : ""}`} key={step}><span>{index < 2 ? "✓" : index + 1}</span><div><strong>{step}</strong><small>{index === 0 ? "Screenshot + accessibility tree + axe baseline" : index === 1 ? "Judging the rendered experience" : index === 2 ? "Waiting for source access" : "Evidence required before verification"}</small></div></div>)}</div>
      <div className="panel evidence"><div className="section-title"><span>RENDER EVIDENCE</span><span className="reticle-label">LIVE VIEW</span></div><div className="screenshot"><div className="corner tl"/><div className="corner tr"/><div className="corner bl"/><div className="corner br"/><div className="mock-nav">Acme Store <span>Products&nbsp;&nbsp; Cart</span></div><div className="mock-content"><p>New collection</p><h2>Made for everyday.</h2><button>Checkout</button></div></div><div className="evidence-meta"><span>Before render</span><span className="chip issue">Contrast failure · 3.2:1</span></div></div></section>
    <section className="findings"><div className="section-title"><span>FINDINGS</span><span>{findings.length} user-impacting issues</span></div><div className="finding-grid">{findings.map((finding) => <article className="finding" key={finding.id}><div className="finding-top"><code>{finding.id}</code><span className={`chip ${finding.status.toLowerCase()}`}>{finding.status}</span></div><h3>{finding.title}</h3><p className="wcag">WCAG {finding.wcag}</p><p>{finding.helps}</p><footer><span className={`impact ${finding.impact.toLowerCase()}`}>{finding.impact} impact</span><button className="quiet">View evidence →</button></footer></article>)}</div></section>
  </main>;
}
