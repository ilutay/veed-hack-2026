# TeamBox deployment boundary

These are reviewed templates, not evidence of a deployment. Nothing in this
directory is installed automatically and no remote state was changed while it
was written.

## Trust boundary

```text
Internet
  -> Caddy :443
  -> Next 127.0.0.1:3000 as pioneer-gym
  -> /run/pioneer-gym/codex-action.sock
  -> narrow gateway as codex-runner
  -> codex app-server proxy --sock /run/teambox-codex/app-server.sock
  -> existing teambox-codex.service and its protected auth
```

Next never receives the Codex auth file and cannot open the app-server socket.
The gateway accepts one 4-byte big-endian length-prefixed JSON frame, capped at
64 KiB. The JSON body has exactly `version`, `requestId`, and `actionRequest`.
Only these four actions are accepted:

- `interpret_goal`
- `author_rep`
- `assess_response`
- `decide_next`

There are no request fields for a model prompt, cwd, model, config, thread ID,
downstream socket, or approval policy. The gateway loads repository `SKILL.md`
files, builds the prompt, fixes read-only/no-network/never-approve policy,
supplies the action's committed output schema, and validates output bindings by
calling `runCodexAction`. Any tool item, malformed output, binding failure,
timeout, or hidden deterministic fallback fails the live request closed.

The direct proxy adapter targets the generated app-server protocol shipped by
Codex CLI `0.149.0`. It initializes one ephemeral thread per action and never
exposes the general app-server JSON-RPC surface to Next. Re-run the offline tests
and one explicit live smoke after every Codex CLI upgrade.

## Preflight before installation

Run these checks on TeamBox without reading an auth file or printing an
environment value:

```bash
codex --version
systemctl is-active teambox-codex.service
systemctl is-enabled teambox-codex.service
systemctl show teambox-codex.service -p NRestarts --value
test -S /run/teambox-codex/app-server.sock
command -v teambox-codex-workspace
```

The version must be exactly `codex-cli 0.149.0`. Provision the dedicated
`pioneer-gym` workspace with `teambox-codex-workspace pioneer-gym`. Confirm its
reported canonical path before installation. This source pins the repository
and Codex cwd to the provisioner's canonical path
`/srv/codex-workspaces/pioneer-gym/veed-hack-2026`. Never turn the path into an
HTTP or Unix-socket request field, and do not use a symlink to escape the
provisioned workspace.

Also verify that `/usr/local/bin/codex` is the root-owned `0.149.0` executable.
If the installed binary lives elsewhere, install a root-owned link at that
fixed path. Do not add a caller-selectable binary path.

## Build and install outline

Build from the provisioned repository as the deployment operator:

```bash
npm ci
npm run typecheck
npm test
npm run build
./node_modules/.bin/tsc -p ops/teambox/tsconfig.gateway.json
```

The provisioned Codex workspace is intentionally private to `codex-runner`, so
the `pioneer-gym` web user must not run Next from that directory. Publish the
standalone Next output to a root-owned, read-only release directory instead:

```bash
release=/srv/pioneer-gym/releases/<git-sha>
install -d -o root -g root -m 0755 "$release"
cp -a .next/standalone/. "$release/"
install -d -o root -g root -m 0755 "$release/.next"
cp -a .next/static "$release/.next/static"
test ! -d public || cp -a public "$release/public"
install -d -o root -g root -m 0755 "$release/codex/skills"
cp -a codex/skills/pioneer-gym* "$release/codex/skills/"
chown -R root:root "$release"
find "$release" -type d -exec chmod 0755 {} +
find "$release" -type f -exec chmod 0644 {} +
ln -sfn "$release" /srv/pioneer-gym/current.next
mv -Tf /srv/pioneer-gym/current.next /srv/pioneer-gym/current
```

Replace `<git-sha>` with the verified full commit hash; do not derive it from a
request or untrusted environment value. `pioneer-gym-next.service` runs this
standalone release. The protected Codex gateway continues to run from, and pin
Codex cwd to, the provisioned workspace after that workspace is checked out at
the same commit. The web release contains the same Pioneer Gym skill files so
both sides reject a live action when any skill name, path, digest, or byte
length differs.

Create Linux users/groups so that:

- `pioneer-gym` can connect to the action socket but cannot join the
  `teambox-codex` socket group.
- `codex-runner` receives the Pioneer Gym action socket through systemd socket
  activation, joins only `teambox-codex` for the private app-server socket, and
  cannot read the web app environment or protected Codex auth store.
- standalone release files and systemd/Caddy configuration are root-owned and
  not writable by either service user.

Install the two unit files and socket unit under `/etc/systemd/system/`. Put only
the web app's provider configuration in
`/etc/pioneer-gym/pioneer-gym.env` with mode `0640`, owner `root`, group
`pioneer-gym`. Do not put Codex credentials in that file. Copy the Caddy site
into the host's Caddy configuration, validate with `caddy validate`, then enable
the socket, Next, and Caddy. The gateway service is static and starts only when
the socket receives a connection; do not enable or start it directly.

The shared demo access code, secure cookie, rate limits, and global provider
budget are enforced by the Next application. Caddy limits request bodies and
terminates TLS; it is not the authorization authority.

## Required verification

Before sharing the URL, collect sanitized evidence for each boundary:

```bash
systemctl is-active teambox-codex.service pioneer-gym-codex-gateway.service pioneer-gym-next.service caddy
systemctl show pioneer-gym-codex-gateway.service -p NRestarts --value
ss -ltn
ss -lx | grep -E 'pioneer-gym|teambox-codex'
curl --fail --silent --show-error https://pioneer-gym.172.237.110.48.sslip.io/api/health
```

Expected network state: Caddy alone owns public TCP 80/443, Next owns only
`127.0.0.1:3000`, and both Codex surfaces are Unix sockets. Verify as the
`pioneer-gym` user that opening `/run/teambox-codex/app-server.sock` and reading
the Codex auth location are denied. Verify as `codex-runner` that a typed action
succeeds but an envelope with any extra `prompt`, `cwd`, `model`, `config`,
`threadId`, `socket`, or `approvalPolicy` field is rejected.

Provider calls remain governed by the repository `AGENTS.md`: use the sanctioned
environment runner and require explicit current-turn live intent before a smoke.
