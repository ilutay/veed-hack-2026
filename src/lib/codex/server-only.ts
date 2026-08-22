/**
 * Runtime guard for modules that must never execute in a browser bundle.
 *
 * The project does not depend directly on Next's `server-only` marker package,
 * so keep this boundary local and dependency-free.
 */
if (typeof window !== "undefined") {
  throw new Error("The Pioneer Gym Codex runtime is server-only");
}
