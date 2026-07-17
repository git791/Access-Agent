import { NextResponse } from "next/server";
import { createRescanSchedule, getRun, schedulesFor } from "../../../../../lib/store";

async function authorized(request: Request, runId: string) {
  const ownerToken = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )accessagent-run-${runId}=([^;]+)`))?.[1];
  if (!ownerToken) return null;
  return (await getRun(runId, ownerToken)) ? ownerToken : null;
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const ownerToken = await authorized(request, runId);
  if (!ownerToken) return NextResponse.json({ error: "Run access denied." }, { status: 403 });
  return NextResponse.json({ schedules: await schedulesFor(ownerToken) });
}

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const ownerToken = await authorized(request, runId);
  if (!ownerToken) return NextResponse.json({ error: "Run access denied." }, { status: 403 });
  const run = await getRun(runId, ownerToken);
  if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const maxPages = Math.min(Math.max(Number(process.env.ACCESSAGENT_MAX_PAGES ?? 5), 1), 15);
  const maxDepth = Math.min(Math.max(Number(process.env.ACCESSAGENT_MAX_DEPTH ?? 2), 0), 2);
  const schedule = await createRescanSchedule(run.targetUrl, ownerToken, maxPages, maxDepth);
  return NextResponse.json({ schedule });
}
