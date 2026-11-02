import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticate,
  register,
  createSession,
  deleteSession,
  cookieToken,
  sessionAccount,
  completeSetup,
  SESSION_COOKIE,
  SESSION_SECONDS,
} from "../../../../lib/auth/store";
import { sameOrigin } from "../../../../lib/auth/access";
import { createRateLimiter, clientIp } from "../../../../lib/http/rate-limit";
const limiter = createRateLimiter();
const LOGIN_ATTEMPTS_PER_EMAIL = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const credentials = z.object({
  email: z.email().trim().max(254),
  password: z
    .string()
    .min(12, "Use at least 12 characters for your password")
    .max(128),
});
const signup = credentials.extend({
  name: z.string().trim().min(2).max(100),
  role: z.enum(["researcher", "vendor"]),
});
const setup = z.object({
  organization: z.string().trim().min(2).max(200),
  purpose: z
    .string()
    .trim()
    .min(10, "Add at least 10 characters describing your work")
    .max(2000),
  payoutEmail: z.union([z.email().max(254), z.literal("")]).default(""),
});
function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}
export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      action: string;
    }>;
  },
) {
  if (!sameOrigin(request)) return bad("Cross-site request rejected", 403);
  const { action } = await params;
  if (!["login", "signup", "logout", "setup"].includes(action))
    return bad("Not found", 404);
  if (
    !limiter.check(`${action}:${clientIp(request.headers)}`, {
      limit: action === "signup" ? 5 : 15,
      windowMs: 60000,
    }).allowed
  )
    return bad("Too many attempts. Please try again in a minute.", 429);
  try {
    if (action === "logout") {
      const token = cookieToken(request);
      if (token) await deleteSession(token);
      const response = NextResponse.json({ redirect: "/login" });
      response.cookies.set(SESSION_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      });
      return response;
    }
    const body = await request.json().catch(() => null);
    if (action === "setup") {
      const account = await sessionAccount(cookieToken(request));
      if (!account) return bad("Sign in to continue", 401);
      const parsed = setup.safeParse(body);
      if (!parsed.success) return bad(parsed.error.issues[0].message);
      if (account.role === "vendor" && !parsed.data.payoutEmail)
        return bad("Add your PayPal payout email");
      await completeSetup(account, parsed.data);
      return NextResponse.json({ redirect: `/${account.role}` });
    }
    const parsed = (action === "signup" ? signup : credentials).safeParse(body);
    if (!parsed.success) return bad(parsed.error.issues[0].message);
    // The per-IP limit trusts X-Forwarded-For, which a client can fake, so
    // also cap login attempts per email. Guessing one account's password from
    // many fake IPs still stops after LOGIN_ATTEMPTS_PER_EMAIL tries.
    if (
      action === "login" &&
      !limiter.check(`login-email:${parsed.data.email.toLowerCase()}`, {
        limit: LOGIN_ATTEMPTS_PER_EMAIL,
        windowMs: LOGIN_WINDOW_MS,
      }).allowed
    )
      return bad("Too many attempts for this account. Try again later.", 429);
    const account =
      action === "signup"
        ? await register(signup.parse(body))
        : await authenticate(parsed.data.email, parsed.data.password);
    if (!account) return bad("Email or password is incorrect", 401);
    const oldToken = cookieToken(request);
    if (oldToken) await deleteSession(oldToken);
    const response = NextResponse.json({
      redirect: account.setup_complete ? `/${account.role}` : "/setup",
    });
    response.cookies.set(SESSION_COOKIE, await createSession(account.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_SECONDS,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("UNIQUE constraint failed: accounts.email") ||
        ("code" in err && err.code === "23505"))
    )
      return bad(
        "Unable to create this account. Try signing in or use another email.",
        409,
      );
    console.error("auth route:", err);
    return bad("Unable to complete your request. Please try again.", 500);
  }
}
