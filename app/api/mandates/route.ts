import { secure } from "../../../lib/auth/access";
import * as handlers from "./handlers";
export const dynamic = "force-dynamic";
export const POST = secure(handlers.POST, ["researcher"]);
export const GET = secure(handlers.GET, ["researcher"]);
export const DELETE = secure(handlers.DELETE, ["researcher"]);
