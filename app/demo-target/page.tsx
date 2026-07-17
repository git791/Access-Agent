"use client";

import { useState } from "react";

/** Controlled target for the live demo. The defects are deliberate and isolated to this route. */
export default function DemoTarget() {
  const [open, setOpen] = useState(false);
  return <main style={{ maxWidth: 720, margin: "48px auto", fontFamily: "Arial, sans-serif" }}>
    <nav><a href="#products">Products</a> <a href="#support">Support</a></nav>
    <p style={{ color: "#999", background: "#fff" }}>New collection: designed for everyone.</p>
    <h1 id="products">Acme Store</h1>
    <img src="/demo-product.svg" />
    <p id="support">A controlled preview used to demonstrate real accessibility findings.</p>
    <input type="email" placeholder="Email address" />
    <button style={{ background: "#9f8c73", color: "#fff", border: 0, padding: 12 }} onClick={() => setOpen(true)}>Checkout</button>
    {open && <div role="dialog" aria-modal="true" style={{ border: "2px solid #222", padding: 24, marginTop: 24 }}><h2>Checkout</h2><p>This dialog intentionally lacks focus management for the demo audit.</p><button onClick={() => setOpen(false)}>Close</button></div>}
  </main>;
}
