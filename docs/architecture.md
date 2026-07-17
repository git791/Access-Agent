# AccessAgent runtime architecture

## Chosen stack

| Concern | Choice | Responsibility |
| --- | --- | --- |
| Isolated patch execution | Vercel Sandbox | Runs agent-generated edits and commands in an isolated Firecracker microVM. |
| Durable orchestration | Inngest | Coordinates audit → patch → verify → retry with per-step history. |
| Agent contracts | OpenAI Structured Outputs + Zod | Validates each role handoff before the next role acts. |
| Live dashboard | Server-Sent Events + Supabase Realtime | Streams trace events and persists reconnectable state. |
| Data and evidence | Supabase Postgres + Storage | Stores runs, findings, verdicts, and screenshot pairs. |
| Browser baseline | Playwright + axe-core | Captures the rendered page and static accessibility signal. |
| Pull request | Octokit | Creates a typed GitHub PR only after verified verdicts. |
| Deployment | Vercel | Hosts the dashboard, Inngest handlers, and Sandbox control plane. |

## Non-negotiable safety boundary

The Next.js application never runs patch commands against a developer machine or production repository. It creates a Vercel Sandbox from a disposable repository reference. Credentials remain server-side; browser screenshots and state are stored as evidence.

## Event flow

1. `audit/requested` starts an Inngest run.
2. The audit role writes a validated `AuditHandoff`.
3. The patch role receives one issue at a time and returns a validated `PatchHandoff` from a Vercel Sandbox.
4. The verify role returns a `Verdict`; failed verdicts loop to patch for at most three attempts.
5. Verified findings are persisted and streamed to the dashboard. The PR role is allowed to run only when all included verdicts are verified.

The canonical TypeScript contracts live in `lib/contracts.ts`; no agent exchanges freeform prose as executable state.
