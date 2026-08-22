/**
 * One strictly nested deadline chain for the live Codex request path.
 *
 * Each outer layer owns cleanup for the layer inside it and therefore needs a
 * small grace window. Caddy's response-header timeout is 25 seconds.
 */
export const LIVE_CODEX_ACTION_DEADLINE_MS = 15_000;
export const LIVE_TEAMBOX_GATEWAY_DEADLINE_MS = 16_000;
export const LIVE_TEAMBOX_CLIENT_DEADLINE_MS = 18_000;
export const LIVE_GYM_PROVIDER_DEADLINE_MS = 20_000;
export const LIVE_GYM_UI_DEADLINE_MS = 22_000;
