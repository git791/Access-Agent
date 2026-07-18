import { DemoNav } from "../demo-nav";

/** Deliberate, isolated accessibility defects for the controlled crawl demo. */
export default function DemoCheckout() {
  return <main style={{ maxWidth: 720, margin: "48px auto", fontFamily: "Arial, sans-serif" }}>
    <DemoNav />
    <h1>Checkout</h1>
    <p style={{ color: "#999", background: "#fff" }}>Secure payment · your details stay private.</p>
    <input autoComplete="cc-name" placeholder="Name on card" />
    <input inputMode="numeric" autoComplete="cc-number" placeholder="Card number" />
    <input autoComplete="postal-code" placeholder="Postal code" />
    <iframe srcDoc="<p>Secure payment provider</p>" style={{ border: 0, display: "block", margin: "16px 0" }} />
    <button>Place order</button>
  </main>;
}
