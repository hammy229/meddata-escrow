# Hackathon Submission Checklist

Tracking every PayPal AI Hackathon submission requirement.

## Repository & licensing

- [ ] Repository is **public**
- [ ] Project is **open source** with an OSI license
- [ ] **MIT** `LICENSE` present (2026, Arham Doshi)
- [ ] MIT license visible in the GitHub **About** section (set license via repo settings/UI)
- [ ] Repository description set
- [ ] Topics added: `paypal`, `ai`, `hackathon`, `healthcare`, `escrow`, `nextjs`, `agentic-commerce`
- [ ] Issues enabled
- [ ] `v0.1 foundation` milestone created

## Runnable from the README

- [ ] One-line pitch
- [ ] Problem statement and target users
- [ ] "How it works" 6-step flow
- [ ] Quick start: clone → install → copy `.env.example` → seed → run
- [ ] Environment variable table
- [ ] PayPal sandbox setup steps
- [ ] Architecture diagram (Mermaid)
- [ ] Project structure
- [ ] License section

## Tools documented (used & how)

- [ ] PayPal (sandbox) — authorize/capture escrow + per-query billing
- [ ] LLM API — matching, NL→query, privacy guard
- [ ] AG Grid — catalog + results tables
- [ ] Render — hosting (`render.yaml`)
- [ ] Postman — API collection

## Demo

- [ ] Hosted demo link (placeholder → real URL)
- [ ] Demo video link — YouTube, **under 3 minutes** (placeholder → real URL)

## Quality gates

- [ ] `npm install` succeeds
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] CI green on `main`

## Data & privacy

- [ ] All data synthetic (Synthea) — **no real patient data**
- [ ] Raw records never leave the vendor; only privacy-safe aggregates returned
- [ ] No secrets committed (only `.env.example` with empty placeholders)
