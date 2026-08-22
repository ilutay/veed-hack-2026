import { useCodexAction } from "@/components/CodexActionProvider";
import { runIdFromBlocks } from "@/lib/codex";
import { useEffect, useState } from "react";

type LibraryEntry = {
  run_id: string;
  topic: string;
  created_at: string;
  status: string;
  title?: string;
};

export function AssetLibrary() {
  const { dispatch, playing, blocks, libraryTick } = useCodexAction();
  const [runs, setRuns] = useState<LibraryEntry[]>([]);
  const currentId = runIdFromBlocks(blocks);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/runs");
        if (!res.ok) return;
        const body = (await res.json()) as { runs?: LibraryEntry[] };
        if (!cancelled) setRuns(body.runs ?? []);
      } catch {
        /* library is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryTick]);

  if (runs.length === 0) return null;

  return (
    <section className="library">
      <h2 className="library-heading">Lessons</h2>
      <p className="dim">
        Every generated lesson stays here. Open one any time
        {playing ? " — pause first to switch the current video." : "."}
      </p>
      <ul className="library-list">
        {runs.map((run) => {
          const current = run.run_id === currentId;
          const locked = playing && !current;
          return (
            <li key={run.run_id}>
              <button
                type="button"
                className="library-item"
                disabled={locked}
                aria-current={current ? "true" : undefined}
                onClick={() => {
                  if (current || locked) return;
                  void dispatch({
                    type: "library_selected",
                    payload: { run_id: run.run_id },
                  });
                }}
              >
                <span className="library-title">
                  {run.title || run.topic}
                </span>
                <span className="library-meta">
                  {current ? "now playing" : run.status}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
