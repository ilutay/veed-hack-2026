import {
  fixtureJsonResponse,
  readTasteLabsFixture,
  tasteLabsErrorResponse,
  verifyTasteLabsAccess,
} from "@/lib/taste-labs/fixture-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function respond(request: Request, headOnly: boolean): Promise<Response> {
  try {
    verifyTasteLabsAccess(request);
    const fixture = await readTasteLabsFixture();
    return fixtureJsonResponse(fixture, headOnly);
  } catch (error) {
    return tasteLabsErrorResponse(error);
  }
}

export function GET(request: Request) {
  return respond(request, false);
}

export function HEAD(request: Request) {
  return respond(request, true);
}
