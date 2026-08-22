import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileProvider, useProfile } from "../ProfileProvider";
import { AgentChat } from "./AgentChat";

const ADA_PROFILE = {
  version: 1 as const,
  name: "Ada",
  slug: "ada",
  created_at: "2026-08-22T00:00:00.000Z",
  updated_at: "2026-08-22T00:00:00.000Z",
  onboarding: { status: "interests" as const },
};

function PageActionProbe() {
  const { pageAction, consumePageAction } = useProfile();
  return (
    <>
      <output data-testid="page-action">{pageAction ? JSON.stringify(pageAction) : "none"}</output>
      <button type="button" onClick={consumePageAction}>Consume action</button>
    </>
  );
}

describe("AgentChat", () => {
  beforeEach(() => window.localStorage.clear());

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("keeps the name exchange visible when chat activates a learner profile", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/profile");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ created: true, profile: ADA_PROFILE }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProfileProvider>
        <AgentChat />
        <PageActionProbe />
      </ProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("agent-chat-toggle"));
    fireEvent.change(screen.getByTestId("agent-chat-input"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByTestId("agent-chat-send"));

    const turns = await screen.findAllByTestId("agent-chat-turn");
    expect(turns.map((turn) => turn.textContent)).toEqual([
      expect.stringContaining("Ada"),
      expect.stringContaining("Nice to meet you, Ada"),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(screen.getByTestId("page-action").textContent!)).toEqual({
      kind: "notice",
      summary: expect.stringContaining("Nice to meet you, Ada"),
    });

    fireEvent.click(screen.getByRole("button", { name: "Consume action" }));
    fireEvent.change(screen.getByTestId("agent-chat-input"), { target: { value: "teach me about entropy" } });
    fireEvent.click(screen.getByTestId("agent-chat-send"));

    expect(JSON.parse((await screen.findByTestId("page-action")).textContent!)).toEqual({
      kind: "start_lesson",
      topic: "entropy",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/turn", expect.anything());
  });
});
