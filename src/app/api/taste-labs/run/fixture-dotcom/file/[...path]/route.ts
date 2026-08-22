import {
  fixtureFileResponse,
  fixtureNotFoundResponse,
  readTasteLabsFixtureFile,
  tasteLabsErrorResponse,
  verifyTasteLabsAccess,
} from "@/lib/taste-labs/fixture-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type FixtureFileContext = {
  params: Promise<{ path: string[] }>;
};

async function respond(
  request: Request,
  context: FixtureFileContext,
  headOnly: boolean,
): Promise<Response> {
  try {
    verifyTasteLabsAccess(request);
    const { path } = await context.params;
    const file = await readTasteLabsFixtureFile(path);
    return file ? fixtureFileResponse(file, headOnly) : fixtureNotFoundResponse();
  } catch (error) {
    return tasteLabsErrorResponse(error);
  }
}

export function GET(request: Request, context: FixtureFileContext) {
  return respond(request, context, false);
}

export function HEAD(request: Request, context: FixtureFileContext) {
  return respond(request, context, true);
}
