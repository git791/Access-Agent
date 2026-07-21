import { DemoNav } from "../demo-nav";

/** Deliberate, isolated accessibility defects for the controlled crawl demo. */
export default function DemoSupport() {
  return <main style={{ maxWidth: 720, margin: "48px auto", fontFamily: "Arial, sans-serif" }}>
    <DemoNav />
    <h1>Support</h1>
    <img src="/demo-product.svg"  alt=""/>
    <p style={{ color: '#595959', background: "#fff" }}>We normally answer within one business day.</p>
    <input placeholder="Order number"  aria-label="Order number"/>
    <textarea placeholder="How can we help?"  aria-label="How can we help?"/>
    <button style={{ background: "#9f8c73", color: "#fff", border: 0, padding: 12 }}>Send message</button>
  </main>;
}
