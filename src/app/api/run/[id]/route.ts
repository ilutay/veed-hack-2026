import { readRun } from "@/lib/runs";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const snap = await readRun(id);
  if (!snap) {
    return Response.json({ error: "unknown run" }, { status: 404 });
  }
  return Response.json(snap);
}
