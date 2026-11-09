# Hackathon Submission Checklist

Tracking every PayPal AI Hackathon submission requirement. Local gates were
re-run on 2026-11-01 (lint with the ignore pattern, typecheck, test, build).
CI and repo settings were last checked on 2026-10-22 and have not been
re-checked since the November commits, which are not pushed yet. Write-up
draft: [`devpost.md`](devpost.md).

## Repository & licensing

- [x] Repository is **public**
- [x] Project is **open source** with an OSI license
- [x] **MIT** `LICENSE` present (2026, Arham Doshi)
- [x] MIT license visible in the GitHub **About** section (set license via repo settings/UI)
- [x] Repository description set
- [x] Topics added: `paypal`, `ai`, `hackathon`, `healthcare`, `escrow`, `nextjs`, `agentic-commerce`
- [x] Issues enabled
- [x] `v0.1 foundation` milestone created

## Runnable from the README

- [x] One-line pitch
- [x] Problem statement and target users
- [x] "How it works" 6-step flow
- [x] Quick start: clone → install → copy `.env.example` → seed → run
- [x] Environment variable table
- [x] PayPal sandbox setup steps
- [x] Architecture diagram (ASCII map in README; Mermaid in `docs/architecture.md`)
- [x] Project structure
- [x] License section

## Tools documented (used & how)

- [x] PayPal (sandbox): authorize/capture escrow and Payouts. Per-query charges are metered in our own ledger, not billed through PayPal
- [x] Claude on Amazon Bedrock: matching, NL→plan, privacy review, sample check, agent
- [x] AG Grid: catalog, vendor order queue, ledger and results tables
- [x] Render: hosting (`render.yaml`)
- [x] Postman: API collection (regenerated from the 0.4.0 spec)

## Demo

- [ ] Devpost write-up finalized from [`devpost.md`](devpost.md)
- [ ] Hosted demo link (placeholder → real URL)
- [ ] Demo video link: YouTube, **under 3 minutes** (placeholder → real URL)

## Quality gates

- [x] `npm install` succeeds (last seen 2026-10-22; not re-run today)
- [ ] `npm run lint` passes. Not today: it also scans local worktree copies outside the source tree. Linting the source alone passes on 2026-11-01
- [x] `npm run typecheck` passes (re-run 2026-11-01)
- [x] `npm test` passes: 511 tests (2026-11-01)
- [x] `npm run build` passes (re-run 2026-11-01)
- [ ] CI green on `main` (last seen 2026-10-22; re-check after the November commits are pushed)

## Data & privacy

- [x] All data synthetic (Synthea): **no real patient data**
- [x] Raw records never leave the vendor; only privacy-safe aggregates returned
- [x] No secrets committed (only `.env.example` with empty placeholders)
- [x] Download links are labelled as mock links; S3 presigned delivery is planned, not in use
