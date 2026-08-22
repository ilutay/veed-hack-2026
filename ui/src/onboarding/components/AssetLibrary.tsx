import { useProfile } from "../ProfileProvider";

/**
 * Every lesson this browser has asked for, newest first. Selecting one
 * re-opens it in the thread; a finished lesson plays immediately because the
 * bridge already knows its job id.
 */
export function AssetLibrary({ onSelect, currentJobId }: { onSelect: (jobId: string) => void; currentJobId?: string }) {
  const { library } = useProfile();
  if (library.length === 0) return null;

  return (
    <section className="library" data-testid="asset-library">
      <h2 className="library-heading">Lessons</h2>
      <p className="dim">Every generated lesson stays here. Open one any time.</p>
      <ul className="library-list">
        {library.map((entry) => {
          const current = entry.jobId === currentJobId;
          return (
            <li key={entry.jobId}>
              <button
                type="button"
                className="library-item"
                data-testid="library-item"
                aria-current={current ? "true" : undefined}
                disabled={current}
                onClick={() => onSelect(entry.jobId)}
              >
                <span className="library-title">{entry.title || entry.topic}</span>
                <span className="library-meta">{current ? "now showing" : entry.status}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
