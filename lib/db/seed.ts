// Database seed.
// Applies lib/db/schema.sql and loads data/catalog.json into a fresh local
// (SQLite) database. Run with `npm run seed`.
// Placeholder — prints intended steps; no DB writes yet.

async function main(): Promise<void> {
  console.log("[seed] meddata-escrow");
  console.log("[seed] TODO: apply lib/db/schema.sql");
  console.log("[seed] TODO: load vendors + datasets from data/catalog.json");
  console.log("[seed] done (placeholder — nothing written).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
