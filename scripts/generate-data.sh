#!/usr/bin/env bash
# Generate synthetic patient data with Synthea into data/synthea/.
# No real patient data is ever used. Placeholder — wiring to come.
#
# Usage: ./scripts/generate-data.sh [population_size]
set -euo pipefail

POP="${1:-1000}"
OUT_DIR="data/synthea"

echo "[generate-data] would generate ~${POP} synthetic patients into ${OUT_DIR}/"
echo "[generate-data] TODO: download/run Synthea and emit CSV/FHIR output."
echo "[generate-data] placeholder — nothing generated."
