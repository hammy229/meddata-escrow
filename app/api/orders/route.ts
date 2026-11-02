import { secure } from "../../../lib/auth/access";
import * as handlers from "./handlers";
export const dynamic = "force-dynamic";
export const GET = secure(handlers.GET, undefined, "orders");
export const POST = secure(handlers.POST, ["researcher"], "orders");
export const PATCH = secure(handlers.PATCH, undefined, "orders");
