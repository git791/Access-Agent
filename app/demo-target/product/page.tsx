import { DemoNav } from "../demo-nav";

/** Deliberate, isolated accessibility defects for the controlled crawl demo. */
export default function DemoProduct() {
  return <main style={{ maxWidth: 720, margin: "48px auto", fontFamily: "Arial, sans-serif" }}>
    <DemoNav />
    <p style={{ color: "#aaa", background: "#fff" }}>Limited release</p>
    <h1>Field jacket</h1>
    <img src="/demo-product.svg"  alt=""/>
    <p>A weather-resistant layer built for everyday movement.</p>
    <input type="number" defaultValue="1" min="1"  aria-label="Form field"/>
    <button style={{ background: "#9f8c73", color: "#fff", border: 0, padding: 12 }}>Add to basket</button>
    <section><h2>Delivery preference</h2><input type="radio" name="delivery"  aria-label="Form field"/> Standard <input type="radio" name="delivery"  aria-label="Form field"/> Express</section>
  </main>;
}
