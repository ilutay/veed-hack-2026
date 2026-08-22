# Pioneer Gym

Pioneer Gym is an RL gym for humans: a learner types what they want to learn,
does a short observable practice rep, sees the evidence, and then attempts a
changed-action transfer challenge. Pioneer certifies the teaching signal and
picks the next eligible rep; Codex is the only execution agent; Tambo only
renders registered components. The live demo trains visual hierarchy for
short-form product video. Hackathon paste-copy lives in `HACKATHON.md`.

The product has three deliberately separate authorities:

- **Codex** is the sole execution agent. Every Codex action is governed by a
  checked-in `codex/skills/pioneer-gym*/SKILL.md` file.
- **Pioneer** is a text-only curriculum optimizer. P1 certifies teaching signal;
  P2 chooses the exact next eligible rep to maximize transferable learning gain
  per minute.
- **Tambo** only renders registered components. It has no agent, tools, backend,
  memory, or curriculum authority.

The primary app is `/`. The gated `/taste-labs` route preserves the teammate
Riso lesson-player work as an explicitly fixture-only design demo; it cannot
start providers, write runs, or impersonate Codex.

## Local development

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Set `GYM_ACCESS_CODE_SHA256` to the SHA-256 digest of the shared demo code and
set `GYM_COOKIE_SECRET` to at least 32 random bytes. Keep `WORKFLOW_MODE=dry-run`
for local development. Follow `AGENTS.md` before any provider-backed stage and
never read or commit `.env.local`.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run test:browser
npm run test:timing
npm run build
./node_modules/.bin/tsc -p ops/teambox/tsconfig.gateway.json
python3 -m unittest discover -s tests -p 'test_*.py'
```

The default suite is offline. The Pioneer live smoke is opt-in and must only be
run with explicit current-stage approval:

```bash
WORKFLOW_MODE=live scripts/with-env.sh npm run smoke:live:pioneer
```

## Architecture and deployment

- `docs/pioneer-gym-architecture.md` is the authoritative product and trust
  boundary.
- `src/lib/gym/` owns the bounded session engine, curriculum loop, idempotency,
  and receipts.
- `src/lib/pioneer/` is the standalone text-only Pioneer module and loopback E2E
  harness.
- `src/lib/codex/` owns typed skill execution and the narrow TeamBox adapter.
- `src/lib/tambo/` owns the registered-component contract and browser-side
  receipt verification.
- `ops/teambox/README.md` describes the reviewed Unix-socket deployment
  boundary. Its templates are not proof that a deployment happened.

## Educational-video assets

The earlier educational-video workflow, fixtures, Python tools, and offline
player-timing tests remain available under `codex/`, `page/`, and `tests/`.
They are supporting source material, not a second web runtime or agent control
plane for Pioneer Gym.
