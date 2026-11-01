import { requireUser } from "@/app/lib/server/clerk-auth";
import { userWorkspaceStub } from "@/app/lib/server/user-workspace";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const { key } = await context.params;
    const value = await userWorkspaceStub(auth.userId).getPref(key);
    return Response.json({ value });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read preference.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  try {
    const { key } = await context.params;
    const body = (await request.json()) as { value?: string };
    if (typeof body.value !== "string") {
      return Response.json({ error: "Missing preference value." }, { status: 400 });
    }
    await userWorkspaceStub(auth.userId).setPref(key, body.value);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save preference.";
    return Response.json({ error: message }, { status: 500 });
  }
}
