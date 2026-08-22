import { mimeFor, resolveRunFile } from "@/lib/runs";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

export const runtime = "nodejs";

async function serve(id: string, pathParts: string[], method: "GET" | "HEAD") {
  const rel = pathParts.join("/");
  const file = await resolveRunFile(id, rel);
  if (!file) {
    return new Response("not found", { status: 404 });
  }
  const info = await stat(file);
  const headers = {
    "Content-Type": mimeFor(file),
    "Content-Length": String(info.size),
    "Cache-Control": "public, max-age=60",
  };
  if (method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, { status: 200, headers });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path: pathParts } = await params;
  return serve(id, pathParts, "GET");
}

export async function HEAD(
  _req: Request,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path: pathParts } = await params;
  return serve(id, pathParts, "HEAD");
}
