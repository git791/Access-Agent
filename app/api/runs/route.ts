import { NextResponse } from "next/server";
import { runtimeConfiguration } from "../../../lib/config";
import { inngest } from "../../../inngest/client";
import { createRun } from "../../../lib/store";
import { assertAuditableUrl } from "../../../lib/url-security";
import { enforceAuditRateLimit } from "../../../lib/rate-limit";
import { authenticatedUser } from "../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const targetUrl = body?.targetUrl;
  if (typeof targetUrl !== "string") return NextResponse.json({ error: "A preview URL is required." }, { status: 400 });
  try { await assertAuditableUrl(targetUrl); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Enter a valid authorized preview URL." }, { status: 400 }); }

  const configuration = runtimeConfiguration();
  if (!configuration.ready) return NextResponse.json({ error: `Live audits are unavailable until configuration is complete: ${configuration.missing.join(", ")}.` }, { status: 503 });
  const user = await authenticatedUser(request);
  if (process.env.ACCESSAGENT_REQUIRE_AUTH === "true" && !user) return NextResponse.json({ error: "Sign in with GitHub before starting an audit." }, { status: 401 });
  try { await enforceAuditRateLimit(request); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to apply audit rate limit." }, { status: 429 }); }
  const runId = crypto.randomUUID();
  const maxPages = Math.min(Math.max(Number(process.env.ACCESSAGENT_MAX_PAGES ?? 5), 1), 15);
  const maxDepth = Math.min(Math.max(Number(process.env.ACCESSAGENT_MAX_DEPTH ?? 2), 0), 2);
  const ownerToken = crypto.randomUUID();
  await createRun({ id: runId, ownerToken, userId: user?.id, targetUrl, status: "queued", message: "Audit queued.", findings: [] });
  await inngest.send({ name: "accessagent/audit.requested", data: { runId, targetUrl, maxPages, maxDepth } });
  const response = NextResponse.json({
    runId,
    message: "Audit queued. Findings will appear only after a real browser audit has completed."
  });
  response.cookies.set(`accessagent-run-${runId}`, ownerToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 });
  return response;
}
