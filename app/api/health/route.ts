import { NextResponse } from "next/server";

/** Lightweight liveness endpoint for the Render worker deployment. */
export function GET() {
  return NextResponse.json({ ok: true, service: "access-agent-worker" });
}
