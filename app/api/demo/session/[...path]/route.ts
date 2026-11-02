import { handleDemoRequest } from "../../../../../lib/demo/session";
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, { params }: Context) {
  return handleDemoRequest(request, (await params).path);
}
export async function POST(request: Request, { params }: Context) {
  return handleDemoRequest(request, (await params).path);
}
export async function PATCH(request: Request, { params }: Context) {
  return handleDemoRequest(request, (await params).path);
}
