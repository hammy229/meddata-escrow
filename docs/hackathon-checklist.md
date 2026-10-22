# Hackathon Submission Checklist

Tracking every PayPal AI Hackathon submission requirement. Last verified
2026-10-22 (repo settings via `gh`, lint/typecheck/test/build locally, CI
green on `main`). Write-up draft: [`devpost.md`](devpost.md).

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

- [x] PayPal (sandbox) — authorize/capture escrow + per-query billing
- [x] Claude on Amazon Bedrock — matching, NL→plan, privacy review, sample check, agent
- [x] AG Grid — catalog + results tables
- [x] Render — hosting (`render.yaml`)
- [x] Postman — API collection

## Demo

- [ ] Devpost write-up finalized from [`devpost.md`](devpost.md)

- [ ] Hosted demo link (placeholder → real URL)
- [ ] Demo video link — YouTube, **under 3 minutes** (placeholder → real URL)

## Quality gates

- [x] `npm install` succeeds
- [x] `npm run lint` passes
- [x] `npm run typecheck` passes
- [x] `npm run build` passes
- [x] CI green on `main`

## Data & privacy

- [x] All data synthetic (Synthea) — **no real patient data**
- [x] Raw records never leave the vendor; only privacy-safe aggregates returned
- [x] No secrets committed (only `.env.example` with empty placeholders)
