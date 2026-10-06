# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub's **Report a vulnerability**
(Security → Advisories) on this repository, rather than opening a public issue.
We'll acknowledge reports as soon as we can.

## Scope & principles

- **No real patient data.** All data in this project is synthetic (Synthea). Do
  not submit or commit real patient data.
- **Raw records never leave the vendor.** Only privacy-safe aggregates are
  returned to buyers; see [`docs/privacy.md`](docs/privacy.md).
- **No secrets in git.** Only `.env.example` (empty placeholders) is tracked.
  Real credentials live in `.env.local` (git-ignored) or the host's secret
  store (e.g. Render environment variables).

## Supported versions

This is a hackathon project under active development; only the latest `main` is
supported.
