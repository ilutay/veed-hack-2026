import { handleGymPost } from "@/lib/gym/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleGymPost(request);
}
