import {
  handleAccessDelete,
  handleAccessGet,
  handleAccessPost,
} from "@/lib/gym/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleAccessGet(request);
}

export async function POST(request: Request) {
  return handleAccessPost(request);
}

export async function DELETE(request: Request) {
  return handleAccessDelete(request);
}
