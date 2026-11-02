// Resetting shared transactional state is intentionally unavailable over HTTP.
export async function POST() {
  return Response.json(
    { error: "Shared demo reset is disabled. Use a local database for demos." },
    { status: 403 },
  );
}
