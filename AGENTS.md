# Job Radar agent guide

## Scope

Read `Job Radar implementation plan.md` and `docs/implementation-status.md` before changing the project. The active product is a public, read-only software-job showcase. The previous local Profile, scoring, SQLite, and Fastify application was retired by user direction in October 2026.

## Working rules

- Check `git status --short --branch` before edits and preserve user changes.
- Use pnpm workspaces; do not add Turborepo.
- Keep the public feed contract in `packages/shared`, validate it with Zod at both producer and browser boundaries.
- Keep the collection bounded. Do not use JobTech Search as a full inventory downloader; do not publish raw ads or full descriptions.
- Do not claim a missing language field proves no Swedish is required. Link to the original advertisement.
- Never log full ads, profiles, resumes, secrets, authorization headers, cookies, or tokens.
- Use fictional data in tests and fixtures.
- Do not add user accounts, candidate Profiles, application tracking, scoring, or a database without a new explicit product decision.
- Never commit, push, tag, publish, create cloud resources, or expose the site beyond loopback without explicit user authorization.

## Commands

```bash
pnpm install
pnpm dev
pnpm check
pnpm format:check
pnpm build
pnpm start
```

`pnpm dev` and `pnpm start` bind only to loopback. Cloud deployment is a separate, explicitly authorized action using `scripts/deploy.sh`.

## Definition of done

Update implementation status and testing documentation when behavior, commands, contracts, infrastructure, or readiness changes. Before handoff, run lint, formatting check, typecheck, tests, build, and the relevant local runtime checks. There is no SQLite migration in this architecture.
