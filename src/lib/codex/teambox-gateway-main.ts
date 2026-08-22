import "./server-only";

import { LIVE_CODEX_ACTION_DEADLINE_MS } from "../contracts/live-deadlines";
import {
  TEAMBOX_FIXED_REPO_ROOT,
  createTeamboxAppServerCodexClient,
} from "./teambox-app-server-client";
import {
  startTeamboxGatewayServer,
  type TeamboxGatewayActionRunner,
} from "./teambox-gateway-server";
import { runCodexAction } from "./runner";

const SYSTEMD_FIRST_LISTEN_FD = 3;

function requireSingleSystemdSocket(): number {
  if (
    process.env.LISTEN_PID !== String(process.pid) ||
    process.env.LISTEN_FDS !== "1"
  ) {
    throw new Error("Expected exactly one systemd-activated AF_UNIX socket");
  }
  return SYSTEMD_FIRST_LISTEN_FD;
}

const client = createTeamboxAppServerCodexClient();
const runAction: TeamboxGatewayActionRunner = async (request, options) =>
  (await runCodexAction(request, {
    mode: "sdk",
    repoRoot: TEAMBOX_FIXED_REPO_ROOT,
    deadlineMs: LIVE_CODEX_ACTION_DEADLINE_MS,
    signal: options.signal,
    client,
    throwOnSdkError: true,
  })) as Awaited<ReturnType<TeamboxGatewayActionRunner>>;

async function main(): Promise<void> {
  const server = await startTeamboxGatewayServer({
    listen: { fd: requireSingleSystemdSocket() },
    runAction,
  });
  const close = () => server.close(() => process.exit(0));
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

main().catch(() => {
  // Never print provider, auth, prompt, app-server, or filesystem details.
  console.error("Pioneer Gym Codex gateway failed to start");
  process.exit(1);
});
