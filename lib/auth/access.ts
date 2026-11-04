import { withDb, getDataset } from "../db/store";
import {
  cookieToken,
  sessionAccount,
  ownsOrder,
  ownsRun,
  type Account,
  type Role,
} from "./store";
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return (
    (!origin || origin === new URL(request.url).origin) &&
    request.headers.get("sec-fetch-site") !== "cross-site"
  );
}
export function secure(
  handler: (request: Request, account: Account) => Promise<Response>,
  roles?: Role[],
  resource?: "orders" | "datasets",
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && !sameOrigin(request))
      return Response.json(
        { error: "Cross-site request rejected" },
        { status: 403 },
      );
    const account = await sessionAccount(cookieToken(request));
    if (!account)
      return Response.json({ error: "Sign in to continue" }, { status: 401 });
    if (!account.setup_complete)
      return Response.json(
        { error: "Complete your account setup", redirect: "/setup" },
        { status: 403 },
      );
    if (roles && !roles.includes(account.role))
      return Response.json(
        { error: "This action is unavailable for your account role" },
        { status: 403 },
      );
    const params = new URL(request.url).searchParams;
    const body =
      request.method === "GET"
        ? null
        : await request
            .clone()
            .json()
            .catch(() => null);
    // Handlers read the order id from different places (?id=, ?orderId= or
    // the body), so every id the request carries must belong to the caller.
    // Checking only one let a request pass with its own id in the URL and
    // act on someone else's order named in the body.
    const orderIds = [
      params.get("orderId"),
      params.get("id"),
      body?.orderId,
    ].filter((id) => id !== null && id !== undefined);
    for (const orderId of orderIds) {
      if (
        typeof orderId !== "string" ||
        !(await withDb(async (db) => await ownsOrder(db, account, orderId)))
      )
        return Response.json({ error: "Order not found" }, { status: 404 });
    }
    if (
      resource === "datasets" &&
      request.method === "PATCH" &&
      typeof body?.datasetId === "string" &&
      !(await withDb(
        async (db) =>
          (await getDataset(db, body.datasetId))?.vendor_id ===
          account.vendor_id,
      ))
    )
      return Response.json({ error: "Dataset not found" }, { status: 404 });
    if (resource === "orders" && request.method === "PATCH") {
      const allowed =
        account.role === "researcher"
          ? [
              "authorize",
              "capture",
              "void",
              "dispute",
              "cancel",
              "resolve",
              "propose_split",
            ]
          : ["deliver", "payout", "resolve", "propose_split"];
      if (!allowed.includes(body?.action))
        return Response.json(
          { error: "Your role cannot perform this order action" },
          { status: 403 },
        );
      // A dispute can only be settled by the side giving in: the buyer drops
      // it and releases the money, or the vendor refunds the buyer. Neither
      // side can rule in its own favor. A split needs both sides, so either may
      // accept one; the escrow service refuses the side that proposed it.
      if (
        body?.action === "resolve" &&
        body?.resolution !== "split" &&
        body?.resolution !==
          (account.role === "researcher" ? "capture" : "void")
      )
        return Response.json(
          {
            error:
              account.role === "researcher"
                ? 'Buyers settle a dispute with resolution "capture" (release the payment)'
                : 'Vendors settle a dispute with resolution "void" (refund the buyer)',
          },
          { status: 403 },
        );
    }
    const runId = params.get("runId");
    if (runId && !(await ownsRun(account, runId)))
      return Response.json({ error: "Run not found" }, { status: 404 });
    const response = await handler(request, account);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
}
