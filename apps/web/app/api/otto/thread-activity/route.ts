import { NextRequest } from "next/server";
import { listProjectThreadActivity } from "@/lib/thread-activity";

export const dynamic = "force-dynamic";

function statusForError(message: string): number {
  if (/not authorized|sign in|session/i.test(message)) return 401;
  if (/not found/i.test(message)) return 404;
  return 400;
}

export async function GET(req: NextRequest): Promise<Response> {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "Project required." }, { status: 400 });

  const result = await listProjectThreadActivity(projectId);
  if (!Array.isArray(result)) {
    return Response.json(result, { status: statusForError(result.error) });
  }

  return Response.json({ activity: result });
}
