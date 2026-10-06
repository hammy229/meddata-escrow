# Contributing

Thanks for your interest in meddata-escrow!

## Getting started

```bash
npm install
cp .env.example .env.local
npm run seed
npm run dev
```

## Before you open a PR

Run the full gate locally — CI runs the same checks:

```bash
npm run lint
npm run typecheck
npm run build
npm run format:check
```

## Commit messages — Conventional Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <description>
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `style`.

Examples:

- `feat(match): rank datasets with embeddings`
- `fix(paypal): void authorization on failed sample check`
- `docs(readme): add PayPal sandbox setup`

## Pull requests

- Keep PRs small and focused.
- Fill out the PR template.
- Never commit secrets — only `.env.example` with empty placeholders.
- All data must remain synthetic (Synthea); no real patient data.

## Code style

ESLint + Prettier + strict TypeScript. Run `npm run format` to auto-format.
