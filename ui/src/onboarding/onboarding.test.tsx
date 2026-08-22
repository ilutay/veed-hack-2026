import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import { App } from "../App";
import { nextDirectionsFor, slugFromName } from "./logic";
import { afterLessonPlan, bootPlan, planFor } from "./workflow";
import { activeSlug, setActiveSlug } from "./storage";
import { installFakeBridge, QUIZ } from "../test/fakeBridge";
import type { LearnerProfile } from "./types";

const COMPLETED = (jobId: string) => ({
  jobId,
  status: "completed",
  videoUrl: `/media/lessons/${jobId}/03-video/lesson-video.mp4`,
  durationSeconds: 15,
  title: "Probability, applied",
});

function ask(text: string) {
  fireEvent.change(screen.getByTestId("thread-input"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("thread-submit"));
}

async function enterAs(name: string) {
  await screen.findByTestId("profile-gate");
  fireEvent.change(screen.getByTestId("profile-name"), { target: { value: name } });
  fireEvent.click(screen.getByTestId("profile-submit"));
}

/** Answers every quiz question with the given choice ids, in order. */
function answerQuiz(quiz: HTMLElement, ids: string[]) {
  within(quiz)
    .getAllByRole("group")
    .forEach((group, i) => {
      const button = within(group)
        .getAllByRole("button")
        .find((b) => b.querySelector(".quiz-id")?.textContent === ids[i])!;
      fireEvent.click(button);
    });
  fireEvent.click(screen.getByTestId("quiz-submit"));
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("onboarding logic", () => {
  it("slugs names the same way the bridge does", () => {
    expect(slugFromName("  Ada Lovelace! ")).toBe("ada-lovelace");
    expect(slugFromName("---")).toBe("");
  });

  it("offers deeper, wider and applied follow-ups", () => {
    expect(nextDirectionsFor("entropy").map((d) => d.kind)).toEqual(["deeper", "wider", "applied"]);
  });
});

describe("workflow plan", () => {
  const profile = (status: LearnerProfile["onboarding"]["status"]): LearnerProfile => ({
    version: 1,
    name: "Ada",
    slug: "ada",
    created_at: "",
    updated_at: "",
    onboarding: { status },
  });
  const event = (action: string, payload: Record<string, unknown>) => ({
    component: "x",
    episodeId: "ep",
    turnId: "t",
    action,
    payload,
  });

  it("boots to the gate without a profile and resumes at the right step with one", () => {
    expect(bootPlan(null).messages[0].block?.componentName).toBe("ProfileGate");
    expect(bootPlan(profile("interests")).messages[0].block?.componentName).toBe("InterestSurvey");
    expect(bootPlan(profile("researching")).messages[0].block?.componentName).toBe("LevelQuiz");
    expect(bootPlan(profile("quiz")).messages[0].block?.componentName).toBe("LevelQuiz");
    expect(bootPlan(profile("scoring")).messages[0].block?.componentName).toBe("RecommendedTopics");
    expect(bootPlan(profile("complete")).messages[0].block?.componentName).toBe("RecommendedTopics");
  });

  it("turns topic picks into lesson starts and leaves gym events alone", () => {
    expect(planFor(event("recommendation.selected", { topic: "entropy" }), null).startLesson).toBe("entropy");
    expect(planFor(event("topic.submitted", { topic: "entropy" }), null).startLesson).toBe("entropy");
    expect(planFor(event("choice.selected", { topic: "x", label: "A" }), null).startLesson).toBe("x");
    expect(planFor(event("probe.answered", { choiceId: "a" }), null)).toEqual({ messages: [] });
    expect(afterLessonPlan("job", "entropy").messages.map((m) => m.block?.componentName)).toEqual([
      "NextChoices",
      "TasteFeedback",
    ]);
  });
});

describe("onboarding flow", () => {
  it("walks a new learner from name to a researched quiz, placement and a personalised lesson", async () => {
    const bridge = installFakeBridge({ settleResearch: false });
    render(<App />);

    // 1. Name gate → profile created on the bridge, survey shown.
    await enterAs("Ada Lovelace");
    await screen.findByTestId("interest-survey");
    expect(activeSlug()).toBe("ada-lovelace");
    expect(bridge.profiles.get("ada-lovelace")?.onboarding.status).toBe("interests");

    // 2. Interests → research starts; the quiz surface waits for it.
    fireEvent.click(screen.getByRole("button", { name: "probability" }));
    fireEvent.click(screen.getByTestId("interests-submit"));
    const waiting = await screen.findByTestId("level-quiz");
    expect(waiting.dataset.status).toBe("researching");
    expect(bridge.profiles.get("ada-lovelace")?.onboarding.status).toBe("researching");

    // 3. Research lands → the quiz mounts with the bridge's questions.
    act(() => bridge.finishResearch());
    // The quiz polls the bridge every PROFILE_POLL_MS, so allow a couple of ticks.
    await waitFor(() => expect(screen.getByTestId("level-quiz").dataset.status).toBe("ready"), { timeout: 5_000 });
    const quiz = screen.getByTestId("level-quiz");
    expect(within(quiz).getAllByRole("group")).toHaveLength(QUIZ.length);
    expect(within(quiz).getAllByRole("group")[0].textContent).toMatch(/coin/);

    // 4. Answers → scoring; recommendations wait, then land through polling.
    answerQuiz(quiz, ["b", "c"]);
    const recs = await screen.findByTestId("recommended-topics");
    expect(recs.dataset.status).toBe("waiting");
    act(() => bridge.finishResearch());
    await waitFor(() => expect(screen.getByTestId("recommended-topics").dataset.status).toBe("ready"), {
      timeout: 5_000,
    });
    expect(screen.getByTestId("profile-badge").textContent).toBe("Ada Lovelace · advanced");
    expect(bridge.lessonBodies()).toHaveLength(0);

    // 5. Pick a recommendation → the render carries the slug so the bridge can pitch it.
    const cards = screen.getAllByTestId("recommended-topic");
    expect(cards).toHaveLength(3);
    fireEvent.click(cards[0]);
    await screen.findByTestId("lesson-video");
    expect(bridge.lessonBodies()[0]).toMatchObject({ topic: "Applying probability to a real case", slug: "ada-lovelace" });
    expect(screen.getAllByTestId("library-item")[0].textContent).toContain("Applying probability to a real case");
  });

  it("sends chat messages to Codex, which decides between a lesson, a test and a reply", async () => {
    const bridge = installFakeBridge();
    render(<App />);
    await enterAs("Ada");
    await screen.findByTestId("interest-survey");

    // "give me a lesson" has no topic: Codex shows the composer, no render starts.
    ask("give me a lesson");
    await screen.findByTestId("prompt-composer");
    expect(bridge.lessonBodies()).toHaveLength(0);
    expect(bridge.turnBodies()[0]).toMatchObject({ slug: "ada" });
    expect(bridge.turnBodies()[0].state).toContain('"give me a lesson"');

    // A request for a test is answered with the quiz surface.
    ask("can I take a test?");
    await waitFor(() => expect(screen.getAllByTestId("level-quiz").length).toBeGreaterThan(0));

    // A named topic becomes a StartLesson, which starts the render.
    ask("teach me about entropy");
    await screen.findByTestId("start-lesson");
    await screen.findByTestId("lesson-video");
    expect(bridge.lessonBodies()).toEqual([
      { topic: "entropy", slug: "ada", episodeId: "ep-local", turnId: expect.any(String) },
    ]);
  });

  it("follows a finished lesson with next choices and taste, and starts the chosen direction", async () => {
    const bridge = installFakeBridge({ job: (jobId) => COMPLETED(jobId) });
    render(<App />);
    await enterAs("Ada");
    await screen.findByTestId("interest-survey");

    ask("entropy");
    await screen.findByTestId("lesson-video-player");
    await screen.findByTestId("next-choices");
    expect(screen.getByTestId("taste-feedback")).toBeDefined();

    // A reaction is recorded on the bridge and acknowledged in the thread.
    fireEvent.click(screen.getByRole("button", { name: "More examples" }));
    await screen.findByText(/Noted — "more examples"/);
    await waitFor(() =>
      expect(bridge.tastes.get("ada")?.history[0]).toMatchObject({ reaction: "more-examples", jobId: "job-1" }),
    );

    // Picking a direction starts the next render directly — no model turn needed.
    const turnsBefore = bridge.turnBodies().length;
    fireEvent.click(screen.getAllByTestId("next-choice")[0]);
    await waitFor(() => expect(bridge.lessonBodies()).toHaveLength(2));
    expect(bridge.lessonBodies()[1].topic).toBe("How entropy actually works, step by step");
    expect(bridge.turnBodies()).toHaveLength(turnsBefore);
    await waitFor(() => expect(screen.getAllByTestId("library-item")).toHaveLength(2));
    expect(screen.getAllByTestId("library-item")[1].textContent).toContain("completed");
  });

  it("remembers the learner across reloads and lets them switch", async () => {
    installFakeBridge();
    const first = render(<App />);
    await enterAs("Ada");
    await screen.findByTestId("interest-survey");
    first.unmount();

    render(<App />);
    await screen.findByTestId("interest-survey");
    expect(screen.queryByTestId("profile-gate")).toBeNull();
    expect(screen.getByText(/Welcome back, Ada/)).toBeDefined();

    fireEvent.click(screen.getByTestId("sign-out"));
    await screen.findByTestId("profile-gate");
    expect(activeSlug()).toBeNull();
  });

  it("falls back to the gate when the remembered profile is gone from the bridge", async () => {
    installFakeBridge();
    setActiveSlug("ghost");
    render(<App />);
    await screen.findByTestId("profile-gate");
    expect(activeSlug()).toBeNull();
  });

  it("surfaces a failed research stage and can retry it", async () => {
    const bridge = installFakeBridge({ failResearch: true });
    render(<App />);
    await enterAs("Ada");
    await screen.findByTestId("interest-survey");
    fireEvent.click(screen.getByRole("button", { name: "probability" }));
    fireEvent.click(screen.getByTestId("interests-submit"));

    await waitFor(() => expect(screen.getByTestId("level-quiz").dataset.status).toBe("failed"));
    expect(screen.getByText(/TAVILY_API_KEY/)).toBeDefined();
    fireEvent.click(screen.getByTestId("quiz-retry"));
    await waitFor(() => expect(screen.getByTestId("level-quiz").dataset.status).toBe("ready"), { timeout: 5_000 });
    expect(bridge.profiles.get("ada")?.onboarding.status).toBe("quiz");
  });

  it("keeps the agent chat usable throughout and writes preferences to the bridge", async () => {
    const bridge = installFakeBridge();
    render(<App />);
    await enterAs("Ada");
    await screen.findByTestId("interest-survey");

    fireEvent.click(screen.getByTestId("agent-chat-toggle"));
    fireEvent.change(screen.getByTestId("agent-chat-input"), { target: { value: "slow down please" } });
    fireEvent.click(screen.getByTestId("agent-chat-send"));
    const turns = await screen.findAllByTestId("agent-chat-turn");
    expect(turns).toHaveLength(2);
    expect(turns[1].textContent).toMatch(/slow down/);
    expect(bridge.tastes.get("ada")?.axes.pace).toBeCloseTo(-0.2);
    expect(bridge.tastes.get("ada")?.notes[0]).toBe("slow down please");
  });
});
