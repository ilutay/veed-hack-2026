import "./server-only";

import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  CODEX_ORCHESTRATOR_SKILL,
  CODEX_STAGE_SKILL_BY_ACTION,
  type CodexAction,
  type SkillReceipt,
} from "./types";

const MAX_SKILL_BYTES = 64 * 1024;

export const STIMULUS_RECEIPT_SKILL_PATH =
  "codex/skills/pioneer-gym-stimulus-receipt/SKILL.md";

export interface LoadedSkill extends SkillReceipt {
  text: string;
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function parseSkillName(text: string, relativePath: string): string {
  if (!text.startsWith("---\n")) {
    throw new Error(`${relativePath} is missing YAML frontmatter`);
  }

  const end = text.indexOf("\n---\n", 4);
  if (end === -1) {
    throw new Error(`${relativePath} has unterminated YAML frontmatter`);
  }

  const frontmatter = text.slice(4, end);
  const match = /^name:\s*([^\n]+)$/mu.exec(frontmatter);
  const name = match?.[1]?.trim();
  if (!name) {
    throw new Error(`${relativePath} frontmatter is missing a name`);
  }
  return name;
}

function assertInsideRepo(repoRoot: string, candidate: string): void {
  const relative = path.relative(repoRoot, candidate);
  if (
    relative === "" ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Skill path escaped the repository root");
  }
}

export async function loadSkill(
  relativePath: string,
  repoRoot = process.cwd(),
): Promise<LoadedSkill> {
  const canonicalRoot = await realpath(repoRoot);
  const requestedPath = path.resolve(canonicalRoot, relativePath);
  assertInsideRepo(canonicalRoot, requestedPath);

  const canonicalSkillPath = await realpath(requestedPath);
  assertInsideRepo(canonicalRoot, canonicalSkillPath);

  const text = await readFile(canonicalSkillPath, "utf8");
  const utf8ByteLength = Buffer.byteLength(text, "utf8");
  if (utf8ByteLength > MAX_SKILL_BYTES) {
    throw new Error(`${relativePath} exceeds the ${MAX_SKILL_BYTES}-byte limit`);
  }

  return {
    name: parseSkillName(text, relativePath),
    relativePath,
    sha256: digest(text),
    utf8ByteLength,
    text,
  };
}

export async function loadCodexActionSkills(
  action: CodexAction,
  repoRoot = process.cwd(),
): Promise<LoadedSkill[]> {
  const paths = [
    CODEX_ORCHESTRATOR_SKILL.relativePath,
    CODEX_STAGE_SKILL_BY_ACTION[action].relativePath,
  ];

  // Deliberately load on every turn. A receipt must describe the exact skill
  // bytes used for that turn, not a process-start cache.
  return Promise.all(paths.map((relativePath) => loadSkill(relativePath, repoRoot)));
}

export async function loadStimulusReceiptSkill(
  repoRoot = process.cwd(),
): Promise<LoadedSkill> {
  return loadSkill(STIMULUS_RECEIPT_SKILL_PATH, repoRoot);
}

export function toSkillReceipt(skill: LoadedSkill): SkillReceipt {
  return {
    name: skill.name,
    relativePath: skill.relativePath,
    sha256: skill.sha256,
    utf8ByteLength: skill.utf8ByteLength,
  };
}
