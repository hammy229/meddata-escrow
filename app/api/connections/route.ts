import { z } from "zod";
import { secure } from "../../../lib/auth/access";
import {
  listConnections,
  saveConnection,
  testConnection,
  deleteConnection,
} from "../../../lib/sources/store";
import { createRateLimiter } from "../../../lib/http/rate-limit";
const limiter = createRateLimiter();
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  if (error instanceof z.ZodError)
    return Response.json({ error: error.issues[0].message }, { status: 400 });
  const message = error instanceof Error ? error.message : "";
  // Driver errors can contain credentials and schema details. Return only our
  // own configuration/validation errors; never serialize the driver object.
  const safe =
    /^(Use a |Set CONNECTION_|This database|This connection|Connection not found|The research view|Expose only|Schema and view|Invalid connection encryption)/.test(
      message,
    );
  return Response.json(
    {
      error: safe
        ? message
        : "Could not connect. Check the host, TLS certificate, read-only login, and research view permissions.",
    },
    { status: message === "Connection not found" ? 404 : 400 },
  );
}
export const GET = secure(
  async (_request, account) =>
    Response.json({ connections: await listConnections(account) }),
  ["vendor"],
);
export const POST = secure(
  async (request, account) => {
    if (!limiter.check(account.id, { limit: 10, windowMs: 60000 }).allowed)
      return Response.json(
        { error: "Too many connection attempts. Try again in a minute." },
        { status: 429 },
      );
    try {
      const body = await request.json();
      if (body.action === "test") {
        await testConnection(account, z.string().parse(body.connectionId));
        return Response.json({ ok: true });
      }
      const id = await saveConnection(account, body);
      return Response.json(
        { id, connections: await listConnections(account) },
        { status: 201 },
      );
    } catch (error) {
      return failure(error);
    }
  },
  ["vendor"],
);
export const DELETE = secure(
  async (request, account) => {
    try {
      const body = await request.json();
      await deleteConnection(account, z.string().parse(body.connectionId));
      return Response.json({ ok: true });
    } catch (error) {
      return failure(error);
    }
  },
  ["vendor"],
);
