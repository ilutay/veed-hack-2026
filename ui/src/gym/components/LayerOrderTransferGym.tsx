import { useState } from "react";
import { useCodexAction } from "../../codex/CodexActionProvider";
import type { LayerOrderTransferGymProps } from "../schemas";

export function LayerOrderTransferGym({
  taskId,
  instruction,
  layers,
}: Partial<LayerOrderTransferGymProps>) {
  const { emit, episodeId, turnId } = useCodexAction();
  // Ordering is local until submitted; Codex only hears the final sequence.
  const [order, setOrder] = useState<string[] | null>(null);

  if (!taskId || !instruction || !layers?.length) {
    return <div data-testid="transfer-pending">Loading transfer task…</div>;
  }

  const current = order ?? layers.map((l) => l.id);

  const move = (id: string, delta: number) => {
    const next = [...current];
    const from = next.indexOf(id);
    const to = from + delta;
    if (to < 0 || to >= next.length) return;
    [next[from], next[to]] = [next[to], next[from]];
    setOrder(next);
  };

  return (
    <section data-testid="layer-order-transfer-gym" data-task-id={taskId}>
      <p data-testid="transfer-instruction">{instruction}</p>
      <ol data-testid="transfer-order">
        {current.map((id) => {
          const layer = layers.find((l) => l.id === id);
          return (
            <li key={id} data-layer-id={id}>
              {layer?.label ?? id}
              <button type="button" onClick={() => move(id, -1)} aria-label={`Move ${id} up`}>
                ↑
              </button>
              <button type="button" onClick={() => move(id, 1)} aria-label={`Move ${id} down`}>
                ↓
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={() =>
          emit({
            component: "LayerOrderTransferGym",
            episodeId,
            turnId,
            action: "transfer.submitted",
            payload: { taskId, order: current },
          })
        }
      >
        Submit order
      </button>
    </section>
  );
}
