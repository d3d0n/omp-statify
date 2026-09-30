---
name: statify-troubleshooting
description: >
  Diagnose omp-statify/Statify problems from local logs: failed Jeff installation,
  Jeff server failed, stopped, unreachable or not starting, Jev key/OpenRouter
  errors, and statusline ! warnings. Use when /statify setup fails or the user
  asks why Statify, Jev, or Jeff isn't working.
---

# Diagnose Statify

## Safety first

- Never read or print `statify.key` or `statify-jeff.key`; check only existence, file type, and permissions (regular files, 0600). Never ask for or paste keys into chat; use the masked `/statify` key dialog.
- Ask before `mise trust`, installs, downloads, enabling filtering, or provider changes. Jev sends classified text to OpenRouter; Jeff `replace` is experimental and can omit relevant text.
- Never kill a process unless its PID matches `statify-jeff-server.json` **and** trimmed `ps -o lstart= -p <pid>` equals the record's `startedAt`. Recheck immediately before any signal. Prefer approved `/statify` server controls; never stop an external server through Statify or kill by port/name.
- Read bounded log excerpts, not environment dumps. Installer logs are sanitized, but server/OMP logs can contain sensitive text: redact secrets before quoting evidence.

## Locate the evidence

- Profile: `$PI_CODING_AGENT_DIR` or `~/.omp/agent`. Contains `statify.json`, `statify-jeff-setup.log`, `statify-jeff-server.log`, `statify-jeff-server.json`, and `statify-jeff-leases/` (one lease per OMP PID). Files are 0600; the lease directory is 0700 (the profile directory's permissions are unchanged). Server record: `{pid, url, startedAt}`. Server log is truncated at each start; setup log at each install attempt. Above 1 MiB, the server log is trimmed to the last 256 KiB at a full-line boundary with `[statify: log trimmed at <ISO time>]`; this is expected.
- Installed plugin: `~/.omp/plugins/node_modules/omp-statify`; its `mise.toml` defines `jeff:setup` and `jeff:serve`. Use the actual absolute plugin path if installed elsewhere.
- Jeff: `${JEFF_DIR:-~/.local/share/omp-statify/jeff}`. Installation requires both `.venv` and `checkpoints/jeff-0.8b/model.safetensors`.
- OMP JSONL logs: `~/.omp/logs/omp.<YYYY-MM-DD>.<pid>.log`. Messages start with `statify`: `usage`, `decision`, `jeff health`, `jeff server started`, `jeff server stopped`, `jeff server exited`, `jeff setup failed`.

## Read-only triage

Use tools to read these files; the following are exact shell equivalents. Missing files are evidence, not a reason to create them. Do not execute repair commands yet.

```sh
profile="${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}"
plugin="$HOME/.omp/plugins/node_modules/omp-statify"
jeff="${JEFF_DIR:-$HOME/.local/share/omp-statify/jeff}"
cat "$profile/statify.json"
tail -n 80 "$profile/statify-jeff-setup.log"
cat "$profile/statify-jeff-server.json"
tail -n 80 "$profile/statify-jeff-server.log"
ls -ld "$profile/statify.key" "$profile/statify-jeff.key"
ls -ld "$jeff/.venv" "$jeff/checkpoints/jeff-0.8b/model.safetensors"
uname -sm
mise --version
grep -h '"message":"statify' "$HOME"/.omp/logs/omp.*.log | tail -n 80
```

1. Check `enabled`, `provider`, `jeffUrl`, and `/statify status`. Missing settings mean disabled Jev defaults; Jeff defaults to `http://127.0.0.1:8765`. An `!` is actionable: invalid mode/settings, missing key, server not installed/stopped/failed, or a request error. `record` makes no provider requests; `shadow` classifies but keeps originals. Errors retain originals.
   Jeff enabled in `replace`/`shadow` but not ready shows `· paused` and keeps originals; starting shows elapsed seconds, and `port N busy` means startup is blocked. Jeff reports classifier input tokens with zero output tokens, so `(N used)` is expected for Jeff too, not evidence of OpenRouter traffic; it supplies no USD cost.
2. For setup failures, identify the first failed command and its exit/error in the setup log, not just the final task wrapper. Check platform (`Darwin arm64`) and mise preflight.
3. For runtime failures, read the record and server tail. Substitute its numeric PID below; compare trimmed output with `startedAt`. A dead/reused PID is failed ownership, not permission to kill another process.

```sh
ps -o lstart= -p <pid>
```

4. Take `<port>` from configured `jeffUrl` (not blindly 8765); substitute the numeric port in these read-only probes:

```sh
lsof -nP -iTCP:<port> -sTCP:LISTEN
curl -s --max-time 2 http://127.0.0.1:<port>/health
```

Health `status: ready` proves readiness, not installation alone. Connection refusal during startup may be transient; correlate timestamps. Reachable health without a running managed record is an **external** server: leave it alone. Managed Jeff starts when enabled/needed and installed, and stops when disabled/switched or the last OMP profile lease exits. Manual Stop leaves Jeff selected but preserves originals until restarted.

5. Correlate OMP `statify jeff health` and server lifecycle messages with the failure time. For Jev, find `statify usage` entries with `api_error`, `httpStatus`, and error detail; do not request the key itself.

## Match the failure

| Evidence/signature | Cause | Fix to propose (approval before changes) |
| --- | --- | --- |
| `supported only on Apple Silicon macOS`; platform not `Darwin arm64` | Unsupported local MLX setup | Use an Apple Silicon Mac, or offer Jev with explicit cloud/provider consent. |
| `Cannot run mise --version`, command not found/ENOENT | mise missing or not on OMP's PATH | `brew install mise`; make mise available to OMP and retry. Never install uv/Python through Homebrew. |
| mise config untrusted / not trusted | Published plugin config needs explicit trust | Review config, then approve `mise trust <absolute plugin mise.toml>` (normally `mise trust "$plugin/mise.toml"`). |
| `mise ... install uv` fails | Pinned uv installation/download problem | Use the actual stderr to repair network, permissions, or mise configuration; retry `mise -C "$plugin" install uv`. |
| git clone/fetch DNS, TLS, connection errors | GitHub/network access failure | Repair connectivity/proxy/certificates, then rerun setup; do not disable TLS verification. |
| `uv python pin` / `uv sync --locked` fails | Python/dependency network failure or lockfile mismatch | Repair network if indicated; rerun pinned setup for mismatch. Never unlock, edit the lockfile, or substitute dependency versions. |
| `hf download` 401/403 | Hugging Face authorization/access failure | Verify model access and approved authentication outside chat; retry setup after resolving it. |
| `hf download` 404 | Pinned model/revision unavailable | Confirm the exact pinned repo/revision in plugin `mise.toml`; report unavailable pin, do not silently choose another model. |
| `hf download` 429 / timeout | Download throttling/network | Wait/retry or repair connectivity, then rerun setup. |
| `No space left on device` | Disk full during install/download | Check available storage and ask before removing anything; free space, rerun setup. |
| `Address already in use` / `[Errno 48]` / statusline `port N busy` | Port occupied | Open `/statify` → Jeff → **Servers & ports**: connect to a listed Jeff server (**this profile**/**external**), choose **Random free port**, or **Enter endpoint…**. Headless: `/statify jeff servers`, then `/statify jeff-url random` or a validated endpoint. Do not kill the port owner. Interactive startup offers these choices; automatic/headless startup only warns. |
| `ModuleNotFoundError` / missing checkpoint | Incomplete/stale Jeff environment or model | Rerun **Install / update Jeff**; setup uses pinned Python/dependencies and model. |
| Uvicorn shutdown lines, then `[jeff:serve] ERROR task failed` | Normal signal stop | No repair if it follows an intentional stop; do not diagnose the wrapper line alone as a crash. |
| Repeated server exits/failures after checking the first error | Broken local environment/model may need a clean pinned install | Offer `/statify` → Jeff → **Reinstall Jeff**; confirmation deletes only `<jeffDir>/.venv` and `<jeffDir>/checkpoints/jeff-0.8b`, then downloads about 2 GB again. Statify stops its managed server first and starts after success when Jeff is enabled; never delete the checkout or shared caches. |
| `[statify: log trimmed at …]` | Expected server-log cap | No repair: logs above 1 MiB retain the last 256 KiB at a full-line boundary. Older output is no longer in that log. |
| Health has `authentication: true`, Jeff key absent | Server requires its own key | `/statify` → Jeff → **Connection settings** → masked Jeff key dialog; OpenRouter key is unrelated. |
| Jev `statify usage`: `api_error`, `httpStatus: 401` | Bad/revoked OpenRouter key | Jev → **Edit API key** (or Add API key when absent). |
| Same, `httpStatus: 402` | Insufficient OpenRouter credits | Ask user to check billing/credits. |
| Same, `httpStatus: 429` | OpenRouter rate limit | Wait/reduce request pressure; retain originals. |
| Same, no `httpStatus` | Network failure or 15 s request timeout | Inspect error detail and connectivity; do not assume an invalid key. |

## Offer the smallest fix

Prefer `/statify` → **Jeff** → **Logs**, **Restart server**, **Install / update Jeff**, or **Connection settings**; **Start server** if stopped and enabled. Jev key repairs use **Jev** → **Edit API key**. Headless controls: `/statify jeff start|stop|restart|logs`; `/statify status` shows server state and log paths.

For busy ports prefer **Servers & ports** or `/statify jeff-url random`; choosing an already running Jeff changes the endpoint without starting a duplicate and never stops an external server. For repeated server failures, offer **Reinstall Jeff** with its explicit deletion/download confirmation rather than manual deletion.

If manual setup is necessary, offer these only after approval: `mise trust "$plugin/mise.toml"`, `mise -C "$plugin" install uv`, `mise -C "$plugin" run jeff:setup`. `jeff:serve` binds loopback and uses `JEFF_PORT` (default 8765); prefer managed controls to creating a second server.

Report briefly:

- **Cause:** confirmed cause, or the remaining uncertainty.
- **Evidence:** 1–3 quoted, redacted lines with log path/time; include health/port result when relevant.
- **Fix:** smallest relevant menu action or command, including any privacy/trust implication.
- **Offer:** “I can run these commands after your approval.” Never claim success before checking health/status afterward.
