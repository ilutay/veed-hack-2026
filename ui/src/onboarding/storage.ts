/**
 * localStorage persistence for profiles and the lesson library.
 *
 * Profiles are keyed by slug so several learners can share a browser and
 * re-enter by name; one key remembers who is signed in. Everything is wrapped
 * in try/catch because storage can be absent (private mode, jsdom without a
 * window, blocked site data) and the app must still boot to the name gate.
 */
import type { LearnerProfile, LibraryEntry } from "./types";

export const ACTIVE_SLUG_KEY = "pioneer-gym.active-profile";
const PROFILE_PREFIX = "pioneer-gym.profile.";
const LIBRARY_KEY = "pioneer-gym.library";
const LIBRARY_MAX = 50;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage is a convenience, never a requirement */
  }
}

export function loadProfile(slug: string): LearnerProfile | null {
  const profile = readJson<LearnerProfile>(PROFILE_PREFIX + slug);
  return profile && profile.version === 1 && profile.slug === slug ? profile : null;
}

export function saveProfile(profile: LearnerProfile): void {
  writeJson(PROFILE_PREFIX + profile.slug, profile);
}

export function activeSlug(): string | null {
  try {
    return storage()?.getItem(ACTIVE_SLUG_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setActiveSlug(slug: string | null): void {
  try {
    if (slug) storage()?.setItem(ACTIVE_SLUG_KEY, slug);
    else storage()?.removeItem(ACTIVE_SLUG_KEY);
  } catch {
    /* ignore */
  }
}

export function loadLibrary(): LibraryEntry[] {
  const rows = readJson<LibraryEntry[]>(LIBRARY_KEY);
  return Array.isArray(rows)
    ? rows.filter((r) => r && typeof r.jobId === "string" && typeof r.topic === "string")
    : [];
}

export function saveLibrary(rows: LibraryEntry[]): void {
  writeJson(LIBRARY_KEY, rows.slice(0, LIBRARY_MAX));
}
