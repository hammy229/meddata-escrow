#!/usr/bin/env bash
# Seed the local database. Thin wrapper around `npm run seed`
# (which runs lib/db/seed.ts). Placeholder.
set -euo pipefail

npm run seed
