import { startRun } from "@/lib/runs";

export const runtime = "nodejs";

export async function POST() {
  const receipt = await startRun();
  return Response.json(receipt, { status: 202 });
}
