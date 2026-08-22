import { handleHealthGet } from "@/lib/gym/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return handleHealthGet();
}
