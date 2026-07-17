import { NextResponse } from "next/server";
import { getRun } from "../../../../lib/store";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const ownerToken = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )accessagent-run-${runId}=([^;]+)`))?.[1];
  if (!ownerToken) return NextResponse.json({ error: "Run access denied." }, { status: 403 });
  const run = await getRun(runId, ownerToken);
  return run ? NextResponse.json(run) : NextResponse.json({ error: "Run not found." }, { status: 404 });
}
