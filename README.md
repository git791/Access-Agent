# AccessAgent

AccessAgent is an accessibility remediation agent that is designed to complete a closed loop: inspect a rendered site, find user-impacting barriers, make a source-level fix on a disposable branch, then inspect the rendered result again before calling that fix verified.

## Current build

This first slice includes the accessible dashboard, run API boundary, agent trace, finding cards, evidence treatment, and safe configuration boundaries. It deliberately does **not** claim that a patch is verified until the Playwright/axe/OpenAI worker is configured and has recorded fresh evidence.

## Run locally

1. Copy `.env.example` to `.env.local` and follow its inline instructions.
2. Install dependencies with `npm install`.
3. Start the app with `npm run dev`.
4. Open `http://localhost:3000`.

The dashboard can be explored without credentials. To activate the full runtime, a human must supply an OpenAI API key plus a path to a disposable repository worktree. GitHub credentials are only needed to open pull requests. The isolated patch runner is Vercel Sandbox, authenticated automatically in a Vercel deployment or with a Vercel development token locally.

## Safety model

- Only scan URLs you own or are authorized to test.
- Patch only a dedicated worktree/branch; never give the agent a main branch checkout.
- Store screenshot evidence for every verified result.
- If verification remains inconclusive after the configured retry limit, mark the issue for human review.

## Controlled demo target

`/demo-target` is intentionally inaccessible and exists only for the live demo. It contains a missing image alternative, an unlabeled email input, insufficient text contrast, and a dialog without focus management. Do not use it as an implementation example.

## Runtime boundary

`POST /api/runs` creates a durable Inngest audit run. Playwright and axe-core create the baseline evidence, the OpenAI Responses API performs visual audit with a JSON Schema contract, and Supabase stores private evidence. The patch, verification, and PR adapters are server-side only and must run against a disposable repository/preview.

## Deployment checklist

1. Apply `supabase/migrations/001_initial.sql` in the Supabase SQL editor.
2. Configure the Vercel dashboard environment values in `.env.example`.
3. Connect the target repository to Vercel so every pushed AccessAgent branch receives a Preview Deployment.
4. Configure `ACCESSAGENT_TEST_COMMAND` for the target repository.
5. Deploy the browser worker to Render as a Docker Web Service. Use the committed `Dockerfile`, set health check path to `/api/health`, and copy the server-side environment variables listed in `.env.example`. This service includes a full Chromium runtime.
6. In Inngest, sync the Render worker endpoint: `https://<your-render-worker>.onrender.com/api/inngest`. Keep the Vercel endpoint for the dashboard/API, but Inngest workflows must use the Render endpoint.

The CI workflow installs Chromium before type-checking and building. Render hosts browser execution; Vercel Sandbox executes any agent-generated patch separately from the dashboard runtime.

Run evidence and records are removed by a daily retention workflow after `ACCESSAGENT_RETENTION_DAYS` (30 by default). Optionally configure `ACCESSAGENT_ALERT_WEBHOOK_URL` to receive failed-run alerts.
