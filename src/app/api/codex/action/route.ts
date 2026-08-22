import { componentBlock, newId, type CodexAction } from "@/lib/codex";
import { startRun } from "@/lib/runs";
import type { TamboComponentContent } from "@tambo-ai/react";

export const runtime = "nodejs";

type Body = {
  episodeId?: string;
  action?: CodexAction;
};

/**
 * Codex event loop. Dry-run only: copies the fixture, never calls fal or Tavily.
 * Returns a receipt plus the next ComponentRenderer block(s).
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const action = body.action;
  if (!action?.type) {
    return Response.json({ error: "missing action" }, { status: 400 });
  }

  const episodeId = body.episodeId || newId("ep");
  const turnId = newId("turn");
  let run_id: string | undefined;
  let blocks: TamboComponentContent[] = [];

  switch (action.type) {
    case "topic_submitted": {
      const receipt = await startRun();
      run_id = receipt.run_id;
      blocks = [componentBlock("LessonPlayer", { run_id }, `player-${run_id}`)];
      break;
    }
    case "playback_ended": {
      run_id = action.payload.run_id;
      blocks = [
        componentBlock("LessonPlayer", { run_id }, `player-${run_id}`),
        componentBlock("NextChoices", { run_id }, `choices-${run_id}`),
      ];
      break;
    }
    case "choice_selected": {
      run_id = action.payload.run_id;
      blocks = [componentBlock("TasteFeedback", { run_id }, `taste-${run_id}`)];
      break;
    }
    case "taste_reaction": {
      run_id = action.payload.run_id;
      const seed =
        action.payload.reaction === "more-examples"
          ? "a concrete worked example"
          : undefined;
      blocks = [
        componentBlock(
          "PromptComposer",
          seed ? { seed_topic: seed } : {},
          `composer-${turnId}`,
        ),
      ];
      break;
    }
    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }

  return Response.json({
    status: "submitted",
    episodeId,
    turnId,
    run_id,
    blocks,
  });
}
