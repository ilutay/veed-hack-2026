import "server-only";

import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { toGymError } from "@/lib/gym/errors";
import { gymRuntime } from "@/lib/gym/runtime";

import {
  TASTE_LABS_FIXTURE_RUN_ID,
  type FixtureLessonScript,
  type FixtureManifest,
  type FixtureRunPayload,
} from "./contracts";

export const PRIVATE_NO_STORE = "private, no-store";

const FIXTURE_DIR = path.join(
  process.cwd(),
  "codex",
  "examples",
  "fixture-run",
);

const FIXTURE_FILES = new Set([
  "lesson-script.json",
  "asset-manifest.json",
  "02-content-generation/narration-timings.json",
  "02-content-generation/talking-head-intro.mp4",
  "02-content-generation/voiceover.mp3",
  "02-content-generation/slide-images/slide-01.png",
  "02-content-generation/slide-images/slide-02.png",
  "02-content-generation/slide-images/slide-03.png",
  "02-content-generation/slide-images/slide-04.png",
  "02-content-generation/slide-images/slide-05.png",
  "02-content-generation/slide-images/slide-06.png",
]);

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
};

function responseHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "cache-control": PRIVATE_NO_STORE,
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  };
}

export function tasteLabsErrorResponse(error: unknown): Response {
  const normalized = toGymError(error);
  return Response.json(
    { error: normalized.message, code: normalized.code },
    { status: normalized.status, headers: responseHeaders() },
  );
}

export function verifyTasteLabsAccess(request: Request): void {
  gymRuntime.access.verifyRequest(request);
}

async function readFixtureJson<T>(relativePath: string): Promise<T> {
  const raw = await readFile(path.join(FIXTURE_DIR, relativePath), "utf8");
  return JSON.parse(raw) as T;
}

export async function readTasteLabsFixture(): Promise<FixtureRunPayload> {
  const [script, manifest, timings] = await Promise.all([
    readFixtureJson<FixtureLessonScript>("lesson-script.json"),
    readFixtureJson<FixtureManifest>("asset-manifest.json"),
    readFixtureJson<FixtureRunPayload["timings"]>(
      "02-content-generation/narration-timings.json",
    ),
  ]);
  return {
    status: "ready",
    run_id: TASTE_LABS_FIXTURE_RUN_ID,
    script,
    manifest,
    timings,
  };
}

export function fixtureJsonResponse(
  payload: FixtureRunPayload,
  headOnly = false,
): Response {
  const body = JSON.stringify(payload);
  return new Response(headOnly ? null : body, {
    headers: {
      ...responseHeaders(),
      "content-length": String(Buffer.byteLength(body)),
    },
  });
}

export type FixtureFile = {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  size: number;
};

export async function readTasteLabsFixtureFile(
  rawSegments: readonly string[],
): Promise<FixtureFile | null> {
  if (rawSegments.length === 0) return null;
  if (
    rawSegments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\") ||
        segment.includes("\0"),
    )
  ) {
    return null;
  }
  const relativePath = rawSegments.join("/");
  if (!FIXTURE_FILES.has(relativePath)) return null;

  const [root, candidate] = await Promise.all([
    realpath(FIXTURE_DIR),
    realpath(path.join(FIXTURE_DIR, ...rawSegments)).catch(() => null),
  ]);
  if (!candidate) return null;
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!candidate.startsWith(prefix)) return null;
  const metadata = await stat(candidate);
  if (!metadata.isFile()) return null;
  const bytes = await readFile(candidate);
  return {
    bytes: Uint8Array.from(bytes),
    contentType:
      CONTENT_TYPES[path.extname(candidate).toLowerCase()] ??
      "application/octet-stream",
    size: metadata.size,
  };
}

export function fixtureFileResponse(
  file: FixtureFile,
  headOnly = false,
): Response {
  return new Response(headOnly ? null : file.bytes, {
    headers: {
      ...responseHeaders(file.contentType),
      "content-length": String(file.size),
    },
  });
}

export function fixtureNotFoundResponse(): Response {
  return Response.json(
    { error: "Fixture file not found.", code: "not_found" },
    { status: 404, headers: responseHeaders() },
  );
}
