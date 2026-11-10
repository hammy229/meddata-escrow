# Hackathon Submission Checklist

Tracking every PayPal AI Hackathon submission requirement. Local gates
(lint, typecheck, test) were re-run on 2026-11-10, and CI was green on `main`
the same day. Write-up draft: [`devpost.md`](devpost.md).

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

- [x] `npm install` succeeds (2026-11-10)
- [x] `npm run lint` passes (2026-11-10)
- [x] `npm run typecheck` passes (2026-11-10)
- [x] `npm test` passes: 1,066 tests (2026-11-10)
- [x] `npm run build` passes (in CI, 2026-11-10)
- [x] CI green on `main` (2026-11-10)
- [x] `npm audit` reports 0 vulnerabilities (2026-11-10)

## Data & privacy

- [x] All data synthetic (Synthea): **no real patient data**
- [x] Raw records never leave the vendor; only privacy-safe aggregates returned
- [x] No secrets committed (only `.env.example` with empty placeholders)
- [x] Download links are labelled as mock links; S3 presigned delivery is planned, not in use
