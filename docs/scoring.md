# M3 eligibility/scoring and M4 review presentation

M3 separates model-assisted extraction from deterministic policy. Codex CLI may extract
bounded facts and propose evidence links; it cannot decide eligibility, weights, scores,
ranking factors, versions, or review state. The only candidate-data input is a
`ConfirmedProfileView` returned by `ProfileRepository.getConfirmedView()`. Pending and
rejected facts never enter the scoring path.

## Extraction contract

`packages/shared/src/scoring.ts` defines one strict Zod object containing:

- required and preferred skills, responsibilities, seniority, required years, languages,
  work authorization, education, domain, location policy, salary, and security clearance;
- `matchedEvidence`, gaps, unknowns, `seniorityFit`, `roleFit`, confidence, and the exact
  extractor version;
- unique bounded requirement IDs and finite bounded numeric fields.

Every matched item has a JD snippet of at most 500 characters, a Profile evidence UUID,
an explanation of at most 500 characters, and depth `mentioned`, `demonstrated`, or
`outcome`. The audit layer reparses strict output, requires at least one match and one gap,
checks every evidence UUID against that exact confirmed Profile version, verifies every
requirement reference, and requires every JD snippet to be an exact substring of the
current job snapshot. Every required skill must be explained by either evidence or a gap.

Extra properties—including a model-supplied Gate or score—are Schema errors. Invalid
JSON, invalid Schema, wrong versions, nonexistent evidence, invented snippets, missing
matches, and missing gaps create a safe attempt record but no formal requirement or score.

## Deterministic eligibility Gate

The Gate runs after audited extraction and before scoring. Its machine-readable reason
codes and user-readable explanations cover:

- closed jobs;
- confirmed company and role-type exclusions;
- authorization country, citizenship, sponsorship, and no-sponsorship conditions;
- onsite/hybrid location range, work-mode compatibility, and remote-country scope;
- explicitly required languages and minimum confirmed proficiency;
- explicitly required security clearance and citizenship conditions.

One explicit contradiction makes `eligible=false`. Missing Profile or posting facts are
`unknown`, remain eligible, are copied to score unknowns, trigger review, and add ranking
uncertainty. Conflicting structured and explicitly extracted work modes are also unknown;
the Gate never chooses one silently. A failed Gate stores auditable extraction and Gate reasons but forces
`matchScore`, `rankingScore`, breakdown, and ranking factors to `null`; it is never encoded
as a low match score.

## Versioned deterministic score

Version `deterministic-weighted-v1` uses immutable code-owned weights:

| Dimension                           | Weight |
| ----------------------------------- | -----: |
| Required-skill evidence coverage    |     30 |
| Skill depth and outcome evidence    |     20 |
| Responsibilities and role direction |     15 |
| Experience and seniority fit        |     15 |
| Domain and business background      |      8 |
| Location and work mode              |      7 |
| Confirmed soft preferences          |      5 |

Coverage is the fraction of extracted requirements with audited evidence. Evidence depth
maps to 0.33, 0.67, and 1.00. Full/partial/none/unknown fit maps to 1.00, 0.60, 0.00, and
0.50. No extracted required skill, depth target, domain, or configured soft-preference
check is neutral at 0.50. Location uses Gate pass/unknown/fail as 1.00/0.50/0.00.

Each component is independently clamped to `[0,1]` and rounded with
`Math.round(weight * ratio)`. Their integer sum is `matchScore` in `[0,100]`. Publication
time never changes this score.

`rankingScore` is separately clamped to `[0,100]`:

```text
matchScore + freshnessBoost + targetCompanyBoost - uncertaintyPenalty
```

Freshness is 5/4/3/2/1/0 points at at most 1/3/7/14/30/more days between publication and
the recorded `rankingAsOf`. A confirmed target company adds 3. Each extraction or Gate
unknown adds 2; low confidence adds `round((1-confidence)*4)`; the total penalty is capped
at 10. The saved `rankingAsOf`, Profile version, snapshot, extraction, extractor version,
and scoring version make a result reproducible.

Confidence below the configured threshold (default 0.65), or any extraction/Gate unknown,
sets the task to `review` and score review state to `pending`.

## M4 presentation and human feedback boundary

The review UI reads the current formal score and history; it does not copy Gate or score
calculation into React. A Gate failure is labeled as an eligibility failure with null
numeric scores, never as zero. `matchScore` is labeled as evidence fit and
`rankingScore` as ordering with freshness/target/uncertainty factors. The detail panel
shows all seven fixed dimensions and weights, Gate machine reasons and readable
explanations, matched JD/Profile evidence IDs and depth, gaps, unknowns, confidence,
extractor/scoring/Profile/snapshot/provider/model versions, and `rankingAsOf`.

Low confidence, unknowns, and pending review expose explicit `pending`, `approved`, and
`rejected` decisions. A decision appends a `score_review_events` row and may update only
the score's review state. Repeating the same state/reason is idempotent. Correction
feedback appends a separate `score_feedback` row containing the server-derived original
formal score, optional human suggested score, type, and required reason. It never rewrites
match/ranking, breakdown, Gate, versions, Profile evidence, weights, or prior history.

The strong-match threshold is the centralized display constant `80`. It affects Dashboard
classification only and is not a scoring rule or scoring-version change.

## Codex CLI provider boundary

`CodexCliProvider` is the only provider. There is no unused OpenAI API implementation or
compatibility branch. It follows the official Codex CLI non-interactive contract:
`codex exec`, `--ephemeral`, `--sandbox read-only`, `--output-schema`, and
`--output-last-message`. It also ignores repository/user instructions, disables tool,
browser, app, plugin, hook, and multi-agent features, and skips repository discovery.

Each attempt creates a private temporary directory and writes only three mode-0600 inputs:
a minimized confirmed Profile, the current normalized snapshot text, and the JSON Schema.
Names, employers, institutions, provenance excerpts, the SQLite database, repository
source, and unrelated environment variables are not supplied. The process uses an argv
array with `shell:false`, a small environment allowlist, a temporary isolated `HOME`, only
the authentication-bearing `CODEX_HOME` path when available, bounded stdout/stderr and
final output, timeout, cancellation, exit checks, and unconditional recursive cleanup.

JD and Profile strings are marked as untrusted data in a static prompt. No prompt, model
output, full JD/Profile, evidence text, secret, token, cookie, or environment dump is
logged. Failure audit stores only bounded safe codes/summaries, byte count, and an output
hash when available.

References:

- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex CLI developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [Codex sandboxing](https://learn.chatgpt.com/docs/sandboxing)

## Queue, invalidation, retry, and history

A task identity is unique across job, current snapshot, Profile version, extractor version,
and scoring version. Transactional claim changes exactly one pending task to running, and a
process-local guard prevents overlapping bounded process calls. A restart converts every
running task to a safe interrupted attempt and returns it to pending unless its finite
attempt budget is exhausted.

Automatic attempts use exponential backoff from the configured base to maximum and stop
at the configured attempt count; configuration rejects a maximum below the base. An explicit retry, backfill, or rescore grants one new
bounded attempt window without resetting historical attempt numbers. No retry or
reprocessing path deletes requirements, scores, or attempts.

Current scores are invalidated when the job snapshot, confirmed Profile version, extractor
version, scoring version, or open/closed state changes. Requirements are invalidated when
their snapshot, Profile, or extractor identity changes. Closed jobs are re-Gated; reopened
jobs can reuse their current snapshot in a new bounded run. Scan ingestion and lifecycle
completion synchronize tasks. Backfill is idempotent and can include closed jobs
explicitly.

The API is an orchestration/query boundary only:

- `GET /api/scoring/queue`
- `POST /api/scoring/backfill`
- `POST /api/scoring/process`
- `POST /api/scoring/tasks/:id/retry`
- `POST /api/jobs/:id/rescore`
- `GET /api/jobs/:id/scoring`

No scheduler, resident scoring worker, notification, application workflow, or score
override is part of M4.
