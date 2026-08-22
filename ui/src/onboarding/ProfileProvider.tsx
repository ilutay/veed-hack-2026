import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  createProfile,
  getChat,
  getProfile,
  postChat,
  postInterests,
  postQuiz,
  postReaction,
  postRetry,
  PROFILE_POLL_MS,
} from "./api";
import { describeMessage, requestNextBlock } from "../codex/client";
import type { CodexComponentCommand } from "../gym/GymBlock";
import { slugFromName, type TasteReaction } from "./logic";
import { activeSlug, loadLibrary, saveLibrary, setActiveSlug } from "./storage";
import type { ChatTurn, LearnerProfile, LibraryEntry, QuizChoiceId } from "./types";

/**
 * The learner's state for the session: who they are, where they are in
 * onboarding, what they have told us about how they like to learn, and the
 * lessons rendered so far.
 *
 * Profiles live on the bridge (one directory per slug); the browser only
 * remembers which slug is signed in, plus the lesson library. While the
 * bridge is researching or scoring, the profile is polled so the surfaces
 * that wait on it (LevelQuiz, RecommendedTopics) update by themselves.
 *
 * This sits beside CodexActionProvider, not inside it. Components still
 * *report* what the learner did through `emit`; this is where they *read*
 * the profile those events mutate.
 */
export interface ProfileContextValue {
  profile: LearnerProfile | null;
  /** True while the signed-in slug is being fetched on boot. */
  booting: boolean;
  /** The profile as of the last write, readable synchronously from callbacks. */
  latest: () => LearnerProfile | null;
  chat: ChatTurn[];
  library: LibraryEntry[];
  /** Enter by name: reopens an existing profile or starts a new one. */
  enter: (name: string) => Promise<{ created: boolean; profile: LearnerProfile }>;
  signOut: () => void;
  refresh: () => Promise<LearnerProfile | null>;
  submitInterests: (interests: string[], goal?: string) => Promise<LearnerProfile>;
  submitQuiz: (answers: Record<string, QuizChoiceId>) => Promise<LearnerProfile>;
  retryResearch: () => Promise<LearnerProfile>;
  /** Free-text preference; resolves to the agent's reply. */
  sendChat: (message: string) => Promise<string>;
  /** The oldest side-chat action not yet applied by the page. */
  pageAction: PageAction | null;
  /** Removes the current page action after the page applies it. */
  consumePageAction: () => void;
  react: (reaction: TasteReaction, jobId?: string) => Promise<void>;
  upsertLibrary: (entry: LibraryEntry) => void;
}

/**
 * The complete allowlist of ways the side chat may affect the main page.
 * Learner text remains data inside these typed actions; it never becomes a
 * model-authored component command.
 */
export type PageAction =
  | { kind: "start_lesson"; topic: string }
  | { kind: "start_practice"; prompt: string }
  | { kind: "render_block"; command: CodexComponentCommand }
  | { kind: "notice"; summary: string };

const ProfileContext = createContext<ProfileContextValue | null>(null);

const POLLING_STATUSES = new Set(["researching", "scoring"]);

/** One to three words, no sentence punctuation: "Eli", "Ada Lovelace". */
function looksLikeName(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length >= 1 && words.length <= 3 && text.length <= 40 && !/[?,;:]/.test(text) && Boolean(slugFromName(text));
}

function cleanActionSubject(text: string): string {
  return text.trim().replace(/^[\s"'“”]+|[\s"'“”.!?]+$/g, "").slice(0, 500);
}

function firstActionSubject(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const subject = match?.[1] ? cleanActionSubject(match[1]) : "";
    if (subject) return subject;
  }
  return null;
}

function isExplicitPreference(text: string): boolean {
  return /\b(?:i prefer|my preference|i learn best|from now on|next time|slow down|speed up|too fast|too slow|too basic|too technical|simpler|plain language|more technical|less technical|more depth|less depth|more examples?|fewer examples?|real-world examples?|more concrete|more practical|more theoretical|start from (?:the )?principles|shorter|longer|more concise|more detailed|use more visuals?|use fewer visuals?|that was confusing|you lost me)\b/i.test(
    text,
  );
}

function requestedPageAction(text: string, profile: LearnerProfile | null): PageAction | null {
  const topic = firstActionSubject(text, [
    /^(?:please\s+)?(?:(?:can|could|would|will) you\s+)?teach me(?:\s+about)?\s+(.+)$/i,
    /^(?:please\s+)?(?:(?:can|could|would|will) you\s+)?explain(?:\s+to me)?\s+(.+)$/i,
    /^(?:i\s+(?:want|wanna|need|would like|'d like)\s+to\s+learn|i(?:'m| am)\s+trying\s+to\s+learn|learn)(?:\s+about)?\s+(.+)$/i,
    /^(?:(?:can|could|would) you\s+)?(?:(?:make|create|give|show)(?:\s+me)?\s+)?(?:a\s+)?(?:lesson|video)\s+(?:on|about|for)\s+(.+)$/i,
    /^(?:i\s+(?:want|need|would like|'d like)\s+)(?:a\s+)?(?:lesson|video)\s+(?:on|about|for)\s+(.+)$/i,
  ]);
  if (topic) return { kind: "start_lesson", topic };

  const statedFocus = firstActionSubject(text, [
    /^(?:i\s+(?:want|need|would like|'d like)\s+to\s+)?practice(?:\s+(?:on|about|with))?\s+(.+)$/i,
    /^(?:(?:can|could|would|will) you\s+)?(?:test|quiz|challenge)\s+me(?:\s+(?:on|about|with))?(?:\s+(.+))?$/i,
    /^(?:(?:can|could|would|will) you\s+)?(?:give|make|set)(?:\s+me)?\s+(?:a\s+)?(?:rep|exercise|quiz|challenge|test)(?:\s+(?:on|about|for))?(?:\s+(.+))?$/i,
    /^(?:test|quiz|challenge)\s+my\s+(?:knowledge|understanding)(?:\s+(?:of|on|about))?(?:\s+(.+))?$/i,
  ]);
  const asksForPractice = /^(?:i\s+(?:want|need|would like|'d like)\s+to\s+)?practice[.!?]*$/i.test(text)
    || /^(?:(?:can|could|would|will) you\s+)?(?:test|quiz|challenge)\s+me[.!?]*$/i.test(text)
    || /^(?:(?:can|could|would|will) you\s+)?(?:give|make|set)(?:\s+me)?\s+(?:a\s+)?(?:rep|exercise|quiz|challenge|test)[.!?]*$/i.test(text);
  if (statedFocus || asksForPractice) {
    const profileFocus = profile?.onboarding.goal?.trim() || profile?.onboarding.interests?.[0]?.trim();
    return {
      kind: "start_practice",
      prompt: (statedFocus || profileFocus || "Give me a practice rep").slice(0, 500),
    };
  }

  return null;
}

function sideChatName(text: string): string | null {
  const explicit = text.match(/^(?:i'?m|my name is|call me|it'?s)\s+(.+)$/i)?.[1];
  const candidate = (explicit ?? text).replace(/[.!]+$/, "").trim();
  const capitalizedBareName = /^(?:[A-Z][\p{L}'-]*)(?:\s+[A-Z][\p{L}'-]*){0,2}$/u.test(candidate);
  return looksLikeName(candidate) && (Boolean(explicit) || capitalizedBareName) ? candidate : null;
}

function replyForCommand(command: CodexComponentCommand): string {
  if (command.componentName === "AgentNote" && typeof command.props.text === "string") {
    return command.props.text;
  }
  if (command.componentName === "StartLesson" && typeof command.props.topic === "string") {
    return `Starting a lesson on “${command.props.topic}”.`;
  }
  if (command.componentName === "LevelQuiz") return "Opening a level check on the main page.";
  if (command.componentName === "RecommendedTopics") return "Showing learning recommendations on the main page.";
  if (command.componentName === "PromptComposer") return "Opening the lesson prompt on the main page.";
  return "I’ve put the next step on the main page.";
}

export function ProfileProvider({ children }: React.PropsWithChildren) {
  const [profile, setProfileState] = useState<LearnerProfile | null>(null);
  const [booting, setBooting] = useState(() => Boolean(activeSlug()));
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [pageActions, setPageActions] = useState<PageAction[]>([]);
  const [library, setLibrary] = useState<LibraryEntry[]>(() => loadLibrary());
  const latestRef = useRef<LearnerProfile | null>(null);
  const sideChatTurnRef = useRef(0);
  const latest = useCallback(() => latestRef.current, []);
  const pageAction = pageActions[0] ?? null;
  const enqueuePageAction = useCallback((action: PageAction) => {
    setPageActions((pending) => [...pending, action]);
  }, []);
  const consumePageAction = useCallback(() => {
    setPageActions((pending) => pending.slice(1));
  }, []);

  const setProfile = useCallback((next: LearnerProfile | null) => {
    latestRef.current = next;
    setProfileState(next);
  }, []);

  const slugOf = useCallback(() => {
    const current = latestRef.current;
    if (!current) throw new Error("no learner profile is active");
    return current.slug;
  }, []);

  const refresh = useCallback(async () => {
    const current = latestRef.current;
    if (!current) return null;
    const next = await getProfile(current.slug);
    // Only apply if the learner has not switched profile meanwhile.
    if (latestRef.current?.slug === current.slug) setProfile(next);
    return next;
  }, [setProfile]);

  // Boot: resume the signed-in slug, if the bridge still has it.
  useEffect(() => {
    const slug = activeSlug();
    if (!slug) return;
    let cancelled = false;
    void (async () => {
      try {
        const [next, turns] = await Promise.all([getProfile(slug), getChat(slug)]);
        if (cancelled) return;
        if (!next) setActiveSlug(null);
        setProfile(next);
        setChat(next ? turns : []);
      } catch {
        if (!cancelled) setProfile(null);
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setProfile]);

  // Poll while the bridge is researching or scoring.
  const status = profile?.onboarding.status;
  const researchStatus = profile?.research?.status;
  useEffect(() => {
    if (!status || !POLLING_STATUSES.has(status) || researchStatus === "failed") return;
    const timer = setInterval(() => void refresh().catch(() => {}), PROFILE_POLL_MS);
    return () => clearInterval(timer);
  }, [status, researchStatus, refresh]);

  const enter = useCallback<ProfileContextValue["enter"]>(
    async (name) => {
      if (!slugFromName(name)) throw new Error("name required");
      const result = await createProfile(name);
      setActiveSlug(result.profile.slug);
      setProfile(result.profile);
      setChat(result.created ? [] : await getChat(result.profile.slug).catch(() => []));
      return result;
    },
    [setProfile],
  );

  const signOut = useCallback(() => {
    setActiveSlug(null);
    setProfile(null);
    setChat([]);
    setPageActions([]);
  }, [setProfile]);

  const submitInterests = useCallback<ProfileContextValue["submitInterests"]>(
    async (interests, goal) => {
      const { profile: next } = await postInterests(slugOf(), interests, goal);
      setProfile(next);
      return next;
    },
    [slugOf, setProfile],
  );

  const submitQuiz = useCallback<ProfileContextValue["submitQuiz"]>(
    async (answers) => {
      const { profile: next } = await postQuiz(slugOf(), answers);
      setProfile(next);
      return next;
    },
    [slugOf, setProfile],
  );

  const retryResearch = useCallback(async () => {
    const { profile: next } = await postRetry(slugOf());
    setProfile(next);
    return next;
  }, [slugOf, setProfile]);

  const sendChat = useCallback<ProfileContextValue["sendChat"]>(
    async (message) => {
      const text = message.trim();
      if (!text) return "";
      const current = latestRef.current;

      const action = requestedPageAction(text, current);
      if (action) {
        const reply =
          action.kind === "start_lesson"
            ? `Starting a lesson on “${action.topic}”.`
            : action.kind === "start_practice"
              ? `Starting a practice rep for “${action.prompt}”.`
              : action.kind === "notice"
                ? action.summary
                : replyForCommand(action.command);
        if (current) {
          const at = new Date().toISOString();
          setChat((prev) => [...prev, { role: "learner", text, at }, { role: "agent", text: reply, at }]);
        }
        enqueuePageAction(action);
        return reply;
      }

      if (isExplicitPreference(text)) {
        if (!current) {
          const summary = "Enter a name first, then I’ll remember that learning preference.";
          enqueuePageAction({ kind: "notice", summary });
          return summary;
        }
        const body = await postChat(current.slug, text);
        setChat(body.turns);
        if (body.profile) setProfile(body.profile);
        enqueuePageAction({ kind: "notice", summary: body.reply });
        return body.reply;
      }

      const requestedName = current ? null : sideChatName(text);
      if (!current && requestedName) {
        // No profile yet: a short reply is taken as the learner's name,
        // otherwise ask for one. Anything longer is a preference we can't
        // store yet.
        const { created, profile: next } = await enter(requestedName);
        const reply = created
          ? `Nice to meet you, ${next.name}. Tell me how you like to learn and I'll remember it.`
          : `Welcome back, ${next.name}. Tell me how you like to learn and I'll remember it.`;
        // `enter` activates the profile and therefore changes AgentChat from
        // its temporary pre-profile transcript to this profile transcript.
        // Keep the exchange here so it survives that source switch.
        const at = new Date().toISOString();
        setChat((prev) => [...prev, { role: "learner", text, at }, { role: "agent", text: reply, at }]);
        enqueuePageAction({ kind: "notice", summary: reply });
        return reply;
      }

      const command = await requestNextBlock({
        episodeId: "ep-local",
        turnId: `side-chat-${(sideChatTurnRef.current += 1)}`,
        state: describeMessage(text),
        ...(current ? { slug: current.slug } : {}),
      });
      const reply = replyForCommand(command);
      if (current) {
        const at = new Date().toISOString();
        setChat((prev) => [...prev, { role: "learner", text, at }, { role: "agent", text: reply, at }]);
      }
      enqueuePageAction({ kind: "render_block", command });
      return reply;
    },
    [enter, enqueuePageAction, setProfile],
  );

  const react = useCallback<ProfileContextValue["react"]>(async (reaction, jobId) => {
    const current = latestRef.current;
    if (!current) return;
    await postReaction(current.slug, reaction, jobId);
  }, []);

  const upsertLibrary = useCallback<ProfileContextValue["upsertLibrary"]>((entry) => {
    setLibrary((prev) => {
      const next = [entry, ...prev.filter((r) => r.jobId !== entry.jobId)];
      saveLibrary(next);
      return next;
    });
  }, []);

  const value = useMemo<ProfileContextValue>(
    () => ({
      profile,
      booting,
      latest,
      chat,
      library,
      enter,
      signOut,
      refresh,
      submitInterests,
      submitQuiz,
      retryResearch,
      sendChat,
      pageAction,
      consumePageAction,
      react,
      upsertLibrary,
    }),
    [
      profile,
      booting,
      latest,
      chat,
      library,
      enter,
      signOut,
      refresh,
      submitInterests,
      submitQuiz,
      retryResearch,
      sendChat,
      pageAction,
      consumePageAction,
      react,
      upsertLibrary,
    ],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside a ProfileProvider");
  return ctx;
}
