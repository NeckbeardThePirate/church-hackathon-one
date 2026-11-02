import { requireUser } from "@/app/lib/server/clerk-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  return Response.json({ userId: auth.userId, provider: auth.provider });
}
