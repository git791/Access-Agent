import { eventsSince } from "../../../../../lib/store";
import { getRun } from "../../../../../lib/store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const ownerToken = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )accessagent-run-${runId}=([^;]+)`))?.[1];
  if (!ownerToken || !await getRun(runId, ownerToken)) return new Response("Run access denied.", { status: 403 });
  const encoder = new TextEncoder();
  let lastId = Number(new URL(request.url).searchParams.get("after") ?? 0);
  const stream = new ReadableStream({
    async start(controller) {
      const poll = async () => {
        try {
          const events = await eventsSince(runId, lastId);
          for (const event of events) { lastId = event.id; controller.enqueue(encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)); }
        } catch (error) { controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : "Event stream failed." })}\n\n`)); }
      };
      await poll();
      const interval = setInterval(poll, 1500);
      request.signal.addEventListener("abort", () => { clearInterval(interval); controller.close(); });
    }
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
