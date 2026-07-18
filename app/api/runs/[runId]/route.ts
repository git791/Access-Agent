import { NextResponse } from "next/server";
import { getRun } from "../../../../lib/store";
import { authenticatedUser } from "../../../../lib/auth";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const ownerToken = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )accessagent-run-${runId}=([^;]+)`))?.[1];
  if (!ownerToken) return NextResponse.json({ error: "Run access denied." }, { status: 403 });
  const user = await authenticatedUser(request);
  if (process.env.ACCESSAGENT_REQUIRE_AUTH === "true" && !user) return NextResponse.json({ error: "Sign in with GitHub to access this run." }, { status: 401 });
  const run = await getRun(runId, ownerToken, user?.id);
  return run ? NextResponse.json(run) : NextResponse.json({ error: "Run not found." }, { status: 404 });
}
