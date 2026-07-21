import { DemoNav } from "../demo-nav";

/** Deliberate, isolated accessibility defects for the controlled crawl demo. */
export default function DemoCatalog() {
  return <main style={{ maxWidth: 720, margin: "48px auto", fontFamily: "Arial, sans-serif" }}>
    <DemoNav />
    <h1>Browse the collection</h1>
    <p style={{ color: '#595959', background: "#fff" }}>Filter by color, fit, and availability.</p>
    <section><h2>Featured jacket</h2><img src="/demo-product.svg"  alt=""/><button>Add jacket to basket</button></section>
    <section><h2>Find your size</h2><select defaultValue=""><option value="">Choose a size</option><option>Small</option><option>Medium</option><option>Large</option></select></section>
    <section><h2>Stock alerts</h2><input type="email" placeholder="Your email"  aria-label="Your email"/><button>Notify me</button></section>
  </main>;
}
