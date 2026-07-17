import { NextResponse } from "next/server";
import { runtimeConfiguration } from "../../../lib/config";
import { inngest } from "../../../inngest/client";
import { createRun } from "../../../lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const targetUrl = body?.targetUrl;
  if (typeof targetUrl !== "string") return NextResponse.json({ error: "A preview URL is required." }, { status: 400 });
  try {
    const url = new URL(targetUrl);
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch { return NextResponse.json({ error: "Enter a valid http(s) preview URL." }, { status: 400 }); }

  const configuration = runtimeConfiguration();
  if (!configuration.ready) return NextResponse.json({ error: `Live audits are unavailable until configuration is complete: ${configuration.missing.join(", ")}.` }, { status: 503 });
  const runId = crypto.randomUUID();
  const maxPages = Math.min(Math.max(Number(process.env.ACCESSAGENT_MAX_PAGES ?? 5), 1), 15);
  await createRun({ id: runId, targetUrl, status: "queued", message: "Audit queued.", findings: [] });
  await inngest.send({ name: "accessagent/audit.requested", data: { runId, targetUrl, maxPages } });
  return NextResponse.json({
    runId,
    message: "Audit queued. Findings will appear only after a real browser audit has completed."
  });
}
