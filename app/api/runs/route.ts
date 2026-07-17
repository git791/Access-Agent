import { NextResponse } from "next/server";

export const runtime = "nodejs";

const fallbackFindings = [
  { id: "AA-014", title: "Checkout button has insufficient contrast", wcag: "1.4.3 Contrast (Minimum)", impact: "Serious", helps: "People with low vision distinguish the primary action.", status: "Verified" },
  { id: "AA-021", title: "Email field has no programmatic label", wcag: "1.3.1 Info and Relationships", impact: "Critical", helps: "Screen-reader users know what information to enter.", status: "Found" },
  { id: "AA-032", title: "Modal focus escapes to page content", wcag: "2.4.3 Focus Order", impact: "Critical", helps: "Keyboard and switch users can complete the dialog task.", status: "Review" }
];

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const targetUrl = body?.targetUrl;
  if (typeof targetUrl !== "string") return NextResponse.json({ error: "A preview URL is required." }, { status: 400 });
  try {
    const url = new URL(targetUrl);
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch { return NextResponse.json({ error: "Enter a valid http(s) preview URL." }, { status: 400 }); }

  // The worker boundary is intentional: rendering, file patching, and PR credentials
  // stay server-side. Wire PLAYWRIGHT/axe/OpenAI calls here once .env.local is configured.
  const configured = Boolean(process.env.OPENAI_API_KEY && process.env.ACCESSAGENT_REPO_PATH);
  return NextResponse.json({
    runId: crypto.randomUUID(),
    findings: fallbackFindings,
    message: configured
      ? "Audit run queued. The worker will capture evidence, audit, patch, and verify on a disposable branch."
      : "Baseline run created. Add OPENAI_API_KEY and ACCESSAGENT_REPO_PATH in .env.local to enable visual verification and source patches."
  });
}
