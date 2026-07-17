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

## Next implementation increment

The `POST /api/runs` endpoint is the worker handoff point. Connect it to Playwright + axe-core for screenshots, accessibility trees, and baseline violations; then call the OpenAI Responses API for visual audit and verification. Keep the patch and PR adapters server-side and require the environment values documented in `.env.example`.
