import { secure } from "../../../lib/auth/access";
import * as handlers from "./handlers";
export const dynamic = "force-dynamic";
export const GET = secure(handlers.GET, ["researcher"]);
export const POST = secure(handlers.POST, ["researcher"]);
