---
name: statify-troubleshooting
description: >
  Diagnose omp-statify/Statify problems from local logs: failed Jeff installation
  or failed/stalled model downloads, Jeff server failed, stopped, unreachable or
  not starting, Jev key/OpenRouter errors, and statusline ! warnings. Use when
  /statify setup fails or the user asks why Statify, Jev, or Jeff isn't working.
---

# Diagnose Statify

## Safety first

- Never read or print `statify.key` or `statify-jeff.key`; check only existence, file type, and permissions (regular files, 0600). Never ask for or paste keys into chat; use the masked `/statify` key dialog.
- Ask before `mise trust`, installs, downloads, enabling filtering, or provider changes. Jev sends classified text to OpenRouter; Jeff `replace` is experimental and can omit relevant text.
- Never kill a process unless its PID matches `statify-jeff-server.json` **and** trimmed `ps -o lstart= -p <pid>` equals the record's `startedAt`. Recheck immediately before any signal. Prefer approved `/statify` server controls; never stop an external server through Statify or kill by port/name.
- Read bounded log excerpts, not environment dumps. Installer logs are sanitized, but server/OMP logs can contain sensitive text: redact secrets before quoting evidence.

## Locate the evidence

- Profile: `$PI_CODING_AGENT_DIR` or `~/.omp/agent`. Contains `statify.json`, `statify-jeff-setup.log`, `statify-jeff-server.log`, `statify-jeff-server.json`, and `statify-jeff-leases/` (one lease per OMP PID). Files are 0600; the lease directory is 0700 (the profile directory's permissions are unchanged). Server record: `{pid, url, startedAt, model?}`; missing `model` means `jeff-0.8b`. Server log is truncated at each start; setup log at each install attempt. Model downloads append sanitized `== Download <label> <ISO time> ==` sections to the setup log. Above 1 MiB, the server log is trimmed to the last 256 KiB at a full-line boundary with `[statify: log trimmed at <ISO time>]`; this is expected.
- Installed plugin: `~/.omp/plugins/node_modules/omp-statify`; its `mise.toml` defines `jeff:setup`, `jeff:serve`, and `jeff:model`. Use the actual absolute plugin path if installed elsewhere. Model repositories and pinned revisions are in `src/jeff-models.ts`.
- Jeff: `${JEFF_DIR:-~/.local/share/omp-statify/jeff}`. Models live in `checkpoints/<id>`: `jeff-0.8b` (default 0.8B v1.0), `jeff-0.8b-v1.1`, or `jeff-2b-v1.1`. Installation readiness requires `.venv` and the selected model's `config.json`, `decision_config.json`, `model.safetensors`, and `readout.safetensors`. Each download also includes `tokenizer.json`, `tokenizer_config.json`, `chat_template.jinja`, and `processor_config.json` (eight files total).
- OMP JSONL logs: `~/.omp/logs/omp.<YYYY-MM-DD>.<pid>.log`. Messages start with `statify`: `usage`, `decision`, `jeff health`, `jeff server started`, `jeff server stopped`, `jeff server exited`, `jeff setup failed`, `jeff model download failed`.

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
# Set model to the jeffModel ID in statify.json; missing field means jeff-0.8b.
model="jeff-0.8b"
ls -ld "$jeff/.venv" "$jeff/checkpoints/$model"
ls -l "$jeff/checkpoints/$model/config.json" "$jeff/checkpoints/$model/decision_config.json" "$jeff/checkpoints/$model/model.safetensors" "$jeff/checkpoints/$model/readout.safetensors"
uname -sm
mise --version
grep -h '"message":"statify' "$HOME"/.omp/logs/omp.*.log | tail -n 80
```

1. Check `enabled`, `provider`, `jeffUrl`, `jeffModel`, and `/statify status`. Missing settings mean disabled Jev defaults; Jeff defaults to `http://127.0.0.1:8765` and model `jeff-0.8b`. An `!` is actionable: invalid mode/settings, missing key, server not installed/stopped/failed, model not downloaded, or a request error. `record` makes no provider requests; `shadow` classifies but keeps originals. Errors retain originals.
   Jeff enabled in `replace`/`shadow` but not ready shows `· paused` and keeps originals; `model not downloaded · paused` means `.venv` exists but the selected checkpoint is incomplete or absent. Download that model through **Models** before starting. Starting shows elapsed seconds, and `port N busy` means startup is blocked. The provider label is `Jeff <short>`; `↓ <short> <pct>%` shows background download progress, not server startup. Jeff reports classifier input tokens with zero output tokens, so `(N used)` is expected for Jeff too, not evidence of OpenRouter traffic; it supplies no USD cost.
2. For setup failures, identify the first failed command and its exit/error in the setup log, not just the final task wrapper. Check platform (`Darwin arm64`) and mise preflight. For failed or stalled model downloads, find the matching `== Download <label> <ISO time> ==` section in that same log and read its output and `exit <code>`, `cancelled`, or `error <message>` footer. Correlate timestamps and disk-byte progress before calling it stalled; inspect DNS/TLS/network errors, HF 401/403/404/429, timeouts, and disk-full errors. Downloads may retain hidden partial files, and progress is an estimate based on directory size, not proof of completion. Cancellation (including session shutdown) keeps partial files; choosing **Download** again resumes them.
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
| `hf download` 401/403 | Hugging Face authorization/access failure | Verify model access and approved authentication outside chat; retry **Models → Download** (or setup for installer failures) after resolving it. |
| `hf download` 404 | Pinned model/revision unavailable | Confirm the selected model's exact repo/revision in plugin `src/jeff-models.ts` (default setup pin also in `mise.toml`); report unavailable pin, do not silently choose another model. |
| `hf download` 429 / timeout / DNS or TLS errors | Download throttling/network | Wait/retry or repair connectivity without disabling TLS verification, then resume through **Models → Download** (or rerun setup for installer failures). |
| `No space left on device` | Disk full during install/download | Check available storage and ask before removing anything; free space, then resume the download. **Delete partial files** is available for an inactive incomplete model; the active model cannot be deleted. |
| `Address already in use` / `[Errno 48]` / statusline `port N busy` | Port occupied | Open `/statify` → Jeff → **Servers & ports**: connect to a listed Jeff server (**this profile**/**external**), choose **Random free port**, or **Enter endpoint…**. Headless: `/statify jeff servers`, then `/statify jeff-url random` or a validated endpoint. Do not kill the port owner. Interactive startup offers these choices; automatic/headless startup only warns. |
| `ModuleNotFoundError` / missing checkpoint / `model not downloaded · paused` | Incomplete/stale Jeff environment or selected model | For missing model files, use **Models → Download** for the selected ID; partial downloads resume. For missing Python/dependencies, rerun **Install / update Jeff**. |
| Uvicorn shutdown lines, then `[jeff:serve] ERROR task failed` | Normal signal stop | No repair if it follows an intentional stop; do not diagnose the wrapper line alone as a crash. |
| Repeated server exits/failures after checking the first error | Broken local environment/model may need a clean pinned install | Offer `/statify` → Jeff → **Reinstall Jeff**; confirmation deletes only `<jeffDir>/.venv` and the active model's `<jeffDir>/checkpoints/<id>`, then reinstalls and downloads the active model again. Statify stops its managed server first and starts after success when Jeff is enabled; never delete the checkout, other models, or shared caches. |
| `[statify: log trimmed at …]` | Expected server-log cap | No repair: logs above 1 MiB retain the last 256 KiB at a full-line boundary. Older output is no longer in that log. |
| Health has `authentication: true`, Jeff key absent | Server requires its own key | `/statify` → Jeff → **Connection settings** → masked Jeff key dialog; OpenRouter key is unrelated. |
| Jev `statify usage`: `api_error`, `httpStatus: 401` | Bad/revoked OpenRouter key | Jev → **Edit API key** (or Add API key when absent). |
| Same, `httpStatus: 402` | Insufficient OpenRouter credits | Ask user to check billing/credits. |
| Same, `httpStatus: 429` | OpenRouter rate limit | Wait/reduce request pressure; retain originals. |
| Same, no `httpStatus` | Network failure or 15 s request timeout | Inspect error detail and connectivity; do not assume an invalid key. |

## Offer the smallest fix

Prefer `/statify` → **Jeff** → **Logs**, **Restart server**, **Install / update Jeff**, or **Connection settings**; **Start server** if stopped and enabled. Jev key repairs use **Jev** → **Edit API key**. Headless controls: `/statify jeff start|stop|restart|logs`; `/statify status` shows server state and log paths.

For busy ports prefer **Servers & ports** or `/statify jeff-url random`; choosing an already running Jeff changes the endpoint without starting a duplicate and never stops an external server. For repeated server failures, offer **Reinstall Jeff** with its explicit deletion/download confirmation rather than manual deletion.

For model failures, prefer **Models → Download** to resume, **Cancel download** to stop a stalled attempt, or **Delete partial files** only after approval for an inactive model. One download runs at a time per OMP process. Headless OMP supports `/statify jeff models`, `/statify jeff download <id>`, and `/statify jeff model <id>`. Switching to a downloaded model restarts only a Statify-managed server; external servers keep their running model and must be left alone. Only the default 0.8B v1.0 was tested with Statify; switching models is not proof of a quality fix.

If manual setup is necessary, offer these only after approval: `mise trust "$plugin/mise.toml"`, `mise -C "$plugin" install uv`, `mise -C "$plugin" run jeff:setup`. `jeff:serve` binds loopback and uses `JEFF_PORT` (default 8765); prefer managed controls to creating a second server.

Report briefly:

- **Cause:** confirmed cause, or the remaining uncertainty.
- **Evidence:** 1–3 quoted, redacted lines with log path/time; include health/port result when relevant.
- **Fix:** smallest relevant menu action or command, including any privacy/trust implication.
- **Offer:** “I can run these commands after your approval.” Never claim success before checking health/status afterward.
