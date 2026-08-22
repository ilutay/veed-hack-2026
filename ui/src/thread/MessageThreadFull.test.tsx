import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MessageThreadFull } from "./MessageThreadFull";
import type { CodexComponentCommand, ThreadMessage } from "./types";

afterEach(cleanup);

function command(overrides: Partial<CodexComponentCommand> = {}): CodexComponentCommand {
  return {
    componentId: "cmp-1",
    componentName: "LessonVideo",
    props: { title: "Masking basics" },
    episodeId: "ep-1",
    turnId: "turn-1",
    ...overrides,
  };
}

function renderThread(overrides: {
  messages?: ThreadMessage[];
  busy?: boolean;
  renderBlock?: (block: CodexComponentCommand) => React.ReactNode;
} = {}) {
  const onSubmit = vi.fn<(text: string) => void>();
  const renderBlock =
    overrides.renderBlock ?? ((block: CodexComponentCommand) => <div>{block.componentName}</div>);
  const view = render(
    <MessageThreadFull
      messages={overrides.messages ?? []}
      onSubmit={onSubmit}
      busy={overrides.busy}
      renderBlock={renderBlock}
    />,
  );
  const input = screen.getByTestId("thread-input") as HTMLTextAreaElement;
  return { onSubmit, input, ...view };
}

describe("MessageThreadFull", () => {
  it("submits the typed prompt and clears the input", () => {
    const { onSubmit, input } = renderThread();

    fireEvent.change(input, { target: { value: "  Teach me softmax  " } });
    fireEvent.click(screen.getByTestId("thread-submit"));

    expect(onSubmit).toHaveBeenCalledWith("Teach me softmax");
    expect(input.value).toBe("");
  });

  it("submits on Enter but not on Shift+Enter", () => {
    const { onSubmit, input } = renderThread();

    fireEvent.change(input, { target: { value: "Teach me softmax" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toBe("Teach me softmax");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit.mock.calls).toEqual([["Teach me softmax"]]);
    expect(input.value).toBe("");
  });

  it("ignores a blank submission", () => {
    const { onSubmit, input } = renderThread();

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables the input and shows the indicator while busy", () => {
    const { onSubmit, input } = renderThread({ busy: true });

    expect(screen.getByTestId("thread-busy")).toBeTruthy();
    expect(input.disabled).toBe(true);
    expect((screen.getByTestId("thread-submit") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "Teach me softmax" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the empty-state hint only until a message arrives", () => {
    const { rerender, onSubmit } = renderThread();
    expect(screen.getByTestId("thread-empty")).toBeTruthy();
    expect(screen.queryAllByTestId("thread-message")).toHaveLength(0);

    rerender(
      <MessageThreadFull
        messages={[{ id: "m1", role: "user", text: "Teach me softmax" }]}
        onSubmit={onSubmit}
        renderBlock={() => null}
      />,
    );
    expect(screen.queryByTestId("thread-empty")).toBeNull();
    expect(screen.getByTestId("thread-message").textContent).toContain("Teach me softmax");
  });

  it("renders an assistant block through the injected renderer", () => {
    const block = command();
    const renderBlock = vi.fn((b: CodexComponentCommand) => (
      <div data-testid="injected-block">{b.componentId}</div>
    ));
    renderThread({
      messages: [
        { id: "m1", role: "user", text: "Teach me softmax" },
        { id: "m2", role: "assistant", text: "Here is your lesson.", block },
      ],
      renderBlock,
    });

    expect(renderBlock).toHaveBeenCalledWith(block);
    expect(screen.getByTestId("injected-block").textContent).toBe("cmp-1");
    expect(screen.getAllByTestId("thread-message")).toHaveLength(2);
  });

  it("labels the input and marks the transcript as a log", () => {
    renderThread();

    expect(screen.getByLabelText("Ask Codex for a lesson")).toBe(screen.getByTestId("thread-input"));
    expect(screen.getByRole("log")).toBe(screen.getByTestId("thread-transcript"));
  });
});
