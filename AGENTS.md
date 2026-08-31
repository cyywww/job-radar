# Job Radar agent guide

## Scope

Read `Job Radar implementation plan.md` and `docs/implementation-status.md` before
changing the project. Preserve the local-first privacy model and phase boundaries.

M1 provides Profile, preferences, onboarding, provenance, confirmation, and immutable
version history. Do not add live job connectors, AI extraction/scoring, automated
applications, or application tracking unless the active task explicitly enters a later
phase.

## Working rules

- Check `git status --short --branch` before edits and preserve user changes.
- Use pnpm workspaces; do not add Turborepo.
- Keep reusable contracts in `packages/shared` and environment parsing in
  `packages/config`.
- Change SQLite through `packages/db/src/schema.ts` plus generated, reviewed migrations.
- Keep request/response payloads Zod-validated at boundaries.
- Treat `ProfileRepository.getConfirmedView()` and `GET /api/profile/confirmed` as the
  only M2/M3-safe candidate-data boundary; pending and rejected facts must stay excluded.
- Never log full job descriptions, profiles, resumes, secrets, authorization headers,
  cookies, or tokens.
- Use fictional data in tests and fixtures.
- Never commit, push, tag, publish, or expose the server beyond loopback without explicit
  user authorization.

## Commands

```bash
pnpm install
pnpm db:migrate
pnpm dev
pnpm check
pnpm format:check
pnpm build
pnpm start
```

`pnpm dev` is the canonical foreground development command for macOS and Codex CLI. It
applies migrations before starting the API and web development servers and exits both on
`Ctrl+C`.

## Definition of done

Update the implementation status and testing documentation when behavior, commands,
contracts, migrations, or phase readiness changes. Before handoff, run lint, formatting
check, typecheck, unit/integration tests, migration-from-empty, build, and the relevant
runtime health checks.
