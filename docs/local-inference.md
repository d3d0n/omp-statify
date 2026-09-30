# Local inference on macOS

Observed 2026-09-29 on Apple Silicon (base M4, 24 GB unified memory, macOS 27.0). Homebrew supplies optional generic inference engines and mise; the installed Statify plugin includes [`mise.toml`](../mise.toml), which pins `uv` and provides Jeff setup/server tasks. Mise installs **only uv** for Jeff; uv installs Python, dependencies and weights. Statify supports an **experimental, explicitly selected local Jeff provider**, which now defaults to `replace` after `/statify on`; Jev via OpenRouter remains the default provider. The [paired Jeff/Jev benchmark](benchmarks.md#paired-jev--local-jeff-08b-relevance-and-latency) observed a wrong answer after Jeff omitted required code. Installation does not switch Statify on; enabling Jeff lets OMP start the local server automatically, and updating an already enabled Jeff restarts it. See [Jeff research](jeff.md) and the [architecture/privacy contract](architecture.md#modes-recovery-and-privacy). Commands below state whether they were exercised; Homebrew engine versions are observed metadata, not pinned installs.

## Prerequisites

| Tool | Channel | Observed 2026-09-29 | Purpose |
|---|---|---|---|
| Homebrew | Homebrew installation | 7.0.6 (`/opt/homebrew`) | Installs engines and optional system tools. |
| mise | Homebrew | 2026.9.12 (`/opt/homebrew/bin/mise`) | Runs the installed plugin's Jeff tasks, providing pinned uv without shell activation. |
| `uv` | mise (`mise.toml`) | 0.12.19 | Installs the Jeff runtime; uv itself enforces Jeff's [`required-version >=0.12.19`](https://github.com/firelex/jeff/blob/db4a13d8db0dc9bd84100b97498620b5f396e25c/pyproject.toml#L54-L56). Homebrew's uv 0.12.18 was too old. |
| Python | uv (`uv python pin 3.14`) | uv-managed CPython 3.14.2 in the verified setup | uv downloads the 3.14 interpreter when needed; Jeff requires ≥3.12. |
| Serving dependencies | uv (`uv.lock`) | 49 packages in the trial | `uv sync --locked --no-default-groups --extra mac` installs exactly the pinned serving and MLX dependencies. |
| git | Xcode Command Line Tools | 2.54.0 (Apple Git-157) | Clones Jeff and checks out its pinned revision. |
| Xcode Command Line Tools | Apple | Installed at `/Library/Developer/CommandLineTools` | Supplies git; a full Xcode installation is unnecessary for prebuilt wheels. |
| `hf` | Jeff's uv environment | `huggingface-hub` 1.31.0 | The setup task downloads the pinned checkpoint; no separate CLI install is needed. |

Jeff publishes 16-bit weight sizes of **1.7 GB** for Qwen3.5-0.8B, **4.2 GB** for Qwen3.5-2B and **9.3 GB** for Gemma4-E2B (about 4.6B stored parameters). Verified setup with the 0.8B checkpoint used **936 MB** for `.venv`, **1.7 GB** for the checkpoint (including repository videos/assets) and **2.8 GB** total for the Jeff checkout including Git history; allow extra shared-cache space and more disk for larger models. On this base M4 with 24 GB unified memory, the earlier trial's restarted server process RSS was **2,189,936 KiB** at 8 s and **2,199,056 KiB** after a request. MLX/Metal unified-memory allocations are **not reliably represented by RSS**: these are not peak total RAM. Gemma MPS memory/viability was not measured. [Published sizes](https://github.com/firelex/jeff/blob/db4a13d8db0dc9bd84100b97498620b5f396e25c/README.md#L117-L128).

## Jeff server

After [installing Statify as an OMP plugin](setup.md#install-and-use-statify), open `/statify` → **Jeff · local (experimental)** → **Install / update Jeff**. The installer runs pinned setup only after explicit approval to trust the absolute installed plugin `mise.toml` and download dependencies/model. It preserves provider and enablement settings. Enable Jeff afterward: Statify automatically starts `mise -C <plugin root> run jeff:serve` when Jeff is enabled in `replace` or `shadow`, health is unreachable, and installation exists; it also does so on session start. It stops its managed server on disablement, switching to Jev, or the last OMP process exiting. Turn start does not auto-restart a stopped/crashed server. Successful install/update while Jeff is enabled restarts the managed server. **Show manual setup instructions** and CLI/headless setup provide absolute trust/install/setup commands, then instructions to enable Jeff for automatic serving; a separate-terminal server is optional. Use the exact single-quoted paths shown by your installation: `/absolute/path/to/installed/omp-statify` below is a **placeholder**, not a runnable path. Tasks run in the installed package directory, not the Jeff checkout. For a source checkout, substitute its absolute path in the same `mise -C` commands; do **not** load the installed plugin and `omp --extension ./src/index.ts` simultaneously.

While Jeff is enabled, use its Start/Stop/Restart menu controls or `/statify jeff start|stop|restart`; Stop leaves filtering enabled but keeps original text until Jeff is available again. `/statify` → Jeff → **Logs** shows both managed server and setup tails; `/statify jeff logs` reports tails and paths, and `/statify status` reports server ownership/state, selected model/download status, and log paths. Managed output is in `statify-jeff-server.log`, installer and model-download output in `statify-jeff-setup.log`, under `$PI_CODING_AGENT_DIR` or `~/.omp/agent`. Both files use `0600`; the server log is truncated per start and the installer transcript per install attempt, while model downloads append sanitized output to the setup log. Diagnostics never log keys. Ask OMP “diagnose Statify Jeff setup” to use the bundled troubleshooting skill.

When enabled in `replace`/`shadow` but not ready, Jeff's statusline ends in `· paused` and originals stay intact; startup shows elapsed seconds (for example `server starting 4s · paused`), and an occupied port shows `port 8765 busy · paused`. Jeff reports input tokens with zero output tokens, so successful replacements also show `(N used)`.

**Servers & ports** lists running local Jeff servers by port with **this profile**/**external** labels and readiness; select one to connect, **Random free port** to pick an unused port and start when enabled, or **Enter endpoint…** to enter a validated address. `/statify jeff servers` and `/statify jeff-url random` work in headless/RPC OMP too. Interactive starts on a busy port offer a random port, a running Jeff server when available, or cancel; automatic/headless starts only warn and remain paused.

Changing the endpoint saves it: an already serving Jeff is used without starting another, stopping this profile's managed server on a different address; otherwise a managed server on another address restarts on the new one, or Jeff starts when enabled in `replace`/`shadow`. Statify never stops an external server.

For repeated server failures, **Reinstall Jeff** is offered in the Jeff menu. It confirms deletion of only `<jeffDir>/.venv` and `<jeffDir>/checkpoints/<active model id>`; it preserves the checkout, other checkpoints, and shared caches, stops the managed server first, runs normal default setup, and downloads the active checkpoint too if it is not the default. It starts the managed server after success when enabled.

The managed server log is trimmed above 1 MiB to its last 256 KiB starting at a full line, with `[statify: log trimmed at <ISO time>]`. The marker is expected, not a failure.

[`jeff:setup`](../mise.toml) clones or fetches Jeff into `${JEFF_DIR:-$HOME/.local/share/omp-statify/jeff}`, checks out `db4a13d8db0dc9bd84100b97498620b5f396e25c`, pins Python 3.14 with `uv python pin 3.14`, syncs the locked serving dependencies with `uv sync --locked --no-default-groups --extra mac`, and downloads `mstrasser/Jeff-Qwen3.5-0.8B` at `d66458d54426fcf52046b896261df8909bbc8b05` via `uv run --no-sync hf download … --local-dir checkpoints/jeff-0.8b`. Setup contacts GitHub, PyPI/package hosts and Hugging Face; classification requests in Jeff mode stay on loopback. No Homebrew uv/Python, global Python, standalone `hf` or mise shell activation is required.

`JEFF_DIR` applies to setup, model download, and serving; use the same override throughout. Checkpoints live under `${JEFF_DIR:-$HOME/.local/share/omp-statify/jeff}/checkpoints/` with the catalog directory names `jeff-0.8b` (default v1.0), `jeff-0.8b-v1.1`, and `jeff-2b-v1.1`. Manual downloads must use these same names for Statify to recognize them.

Use `/statify` → Jeff → **Models** to download, cancel, select, or delete inactive checkpoints; selection restarts a managed server. Headless/RPC equivalents are `/statify jeff models`, `/statify jeff download <id>`, and `/statify jeff model <id>`. Downloads run in the background, one per OMP process, with byte-based statusline progress; shutdown cancels them and leaves partial files for resume. Downloading does not select the checkpoint. v1.1 and 2B are selectable but have not been benchmarked with Statify; see the [pinned catalog](architecture.md#checkpoint-catalog-and-downloads).

The new [`jeff:model`](../mise.toml) task runs in the configured Jeff directory and requires `JEFF_MODEL_REPO` (Hugging Face repository), `JEFF_MODEL_REVISION` (pinned commit), and `JEFF_MODEL_DIR` (checkpoint directory ID). It downloads exactly the eight runtime files listed in the catalog, not repository media/assets. `JEFF_MODEL_DIR` also selects a checkpoint for an optional manual `jeff:serve` run; unset means `jeff-0.8b`. Managed starts supply the saved selection automatically.

**Historical source-checkout trial, verified 2026-09-29 on Apple M4/macOS 27.0:** the complete `jeff:setup` task ran into an empty `/tmp/jeff-research/e2e` override in **245.07 s** (warm uv package cache), produced CPython 3.14.2, `.python-version` `3.14`, a **936 MB** `.venv`, a **1.7 GB** checkpoint and **2.8 GB** checkout. Git HEAD matched the pinned Jeff revision. An earlier manual cold-cache `uv sync` took **116.95 s** and an unpinned model download **158.11 s**; these are distinct observations, not a fresh install forecast. `mise install` was **not run separately** in this trial because uv was already installed; the installed-plugin commands below are the supported procedure, not claimed newly verified in that earlier trial.

```sh
# Replace the placeholder with the absolute installed-plugin path printed by /statify jeff setup.
mise trust '/absolute/path/to/installed/omp-statify/mise.toml'
mise -C '/absolute/path/to/installed/omp-statify' install uv
mise -C '/absolute/path/to/installed/omp-statify' run jeff:setup
```

### MLX backend

The MLX backend loads Qwen3.5 decision checkpoints, **not** Gemma. The default Jeff backend is PyTorch; [`jeff:serve`](../mise.toml) selects `JEFF_BACKEND=mlx`, `JEFF_CHECKPOINT="checkpoints/${JEFF_MODEL_DIR:-jeff-0.8b}"`, `JEFF_HOST=127.0.0.1` and `PORT="${JEFF_PORT:-8765}"`, then runs `uv run --no-sync jeff-serve` inside the configured `JEFF_DIR`. `JEFF_PORT` selects the task's port (default **8765**) and must match Statify's configured endpoint; managed starts set it from that endpoint automatically. `JEFF_API_KEY`, when set in the task's environment, passes through to Jeff. The published M4 **Max** 28 ms per short decision is not a base-M4/Statify latency measurement. [Backend restrictions](https://github.com/firelex/jeff/blob/db4a13d8db0dc9bd84100b97498620b5f396e25c/src/jeff/mlx_backend.py#L26-L33).

**Historical source-checkout trial, verified 2026-09-29 on Apple M4/macOS 27.0:** after setup with the same `JEFF_DIR`, the `jeff:serve` task reached `/health` `ready`; the sample decision returned the results below. For an **optional manual foreground server**, use the exact installed-plugin path printed by `/statify jeff setup` in the command below, keep that terminal running, and make HTTP/OMP checks in another terminal. A reachable manual server is external: Statify uses it but never stops it. Its stdout/stderr remain in that terminal unless you redirect them; they are not the managed server log.

```sh
mise -C '/absolute/path/to/installed/omp-statify' run jeff:serve
```

The earlier trial's warm-filesystem-cache *process restart* reached `/health` `ready` in about **9 s** (1-second timestamp resolution); its initial startup was not precisely timed. The later mise-task run also reached `ready` but was not timed as a cold start.

**Not run here: optional Qwen3.5-2B v1.1 download and manual serving.** After setup, substitute the exact installed-plugin path printed by `/statify jeff setup`; keep `JEFF_DIR` aligned with setup if overridden. Stop any server using port 8765 first. These commands download the catalog pin into the matching directory and serve it without changing Statify's saved selection:

```sh
JEFF_MODEL_REPO=mstrasser/Jeff-Qwen3.5-2B \
JEFF_MODEL_REVISION=6b0ee356755b7d02e1731b807382bc5403d88dbf \
JEFF_MODEL_DIR=jeff-2b-v1.1 \
  mise -C '/absolute/path/to/installed/omp-statify' run jeff:model
JEFF_MODEL_DIR=jeff-2b-v1.1 \
  mise -C '/absolute/path/to/installed/omp-statify' run jeff:serve
```

For 0.8B v1.1, use repository `mstrasser/Jeff-Qwen3.5-0.8B`, revision `8e6694a5a96394dddbf3802a1b9ca4065e254409`, and `JEFF_MODEL_DIR=jeff-0.8b-v1.1` in both commands. The pinned eight-file totals are 1.7 GB for either 0.8B checkpoint and 4.4 GB for 2B v1.1; historical publisher weight sizes and whole-repository trial sizes above measure different things.

### PyTorch backend

Gemma4-E2B needs PyTorch; Qwen also works under PyTorch. The setup task already installs PyTorch as a core dependency. Set `JEFF_DEVICE=mps` explicitly: on macOS Jeff otherwise chooses **CPU**, not MPS ([device selection](https://github.com/firelex/jeff/blob/db4a13d8db0dc9bd84100b97498620b5f396e25c/src/jeff/models.py#L31-L42)). Gemma's 9.3 GB of weights do not predict runtime memory or guarantee MPS kernel coverage. Stop the MLX server first.

**Not run: Gemma4-E2B download and PyTorch MPS serving.** Point `mise -C` at the absolute installed-plugin path printed by `/statify jeff setup` (or at the optional source checkout); `mise exec` supplies the pinned uv to a shell that enters the Jeff directory. The `JEFF_DIR` override, if used during setup, must be exported here too.

```sh
mise -C '/absolute/path/to/installed/omp-statify' exec -- sh -c '
  cd "${JEFF_DIR:-$HOME/.local/share/omp-statify/jeff}"
  uv run --no-sync hf download mstrasser/Jeff-Gemma4-E2B \
    --revision afcb75ae269494582aab3ec3cea0d278685a8cb2 \
    --local-dir checkpoints/jeff-gemma-e2b
  JEFF_BACKEND=pytorch JEFF_DEVICE=mps JEFF_CHECKPOINT=checkpoints/jeff-gemma-e2b \
    JEFF_HOST=127.0.0.1 PORT=8765 exec uv run --no-sync jeff-serve
'
```

### Check the server

The default Jeff bind is `127.0.0.1:8000`; these recipes set `127.0.0.1:8765`. `/health` reports `loading` until a model is assigned and `ready` afterward; in the trial the first reachable HTTP check was already `ready`, not `loading`. It exposes checkpoint information even with authentication enabled. `/v1/models` and `/v1/systemone` require `Authorization: Bearer <key>` only when `JEFF_API_KEY` is set on the server ([routes and auth](https://github.com/firelex/jeff/blob/db4a13d8db0dc9bd84100b97498620b5f396e25c/src/jeff/server.py#L113-L116), [health/models](https://github.com/firelex/jeff/blob/db4a13d8db0dc9bd84100b97498620b5f396e25c/src/jeff/server.py#L188-L201)).

**Verified 2026-09-29 on Apple M4/macOS 27.0: HTTP checks.** With the unkeyed server running, these exact requests produced `200` for all three routes; the sample decision took **1,877 ms** according to `Server-Timing` on its first, warming inference:

```sh
curl -si http://127.0.0.1:8765/health
curl -si http://127.0.0.1:8765/v1/models
curl -i http://127.0.0.1:8765/v1/systemone -H 'content-type: application/json' -d '{"model":"jeff-latest","state":"Refund request: the customer says the parcel arrived crushed and wants their money back.","questions":{"route":{"type":"choice","instructions":"Which team should handle this?","criteria":{"1":"Refunds and payments","2":"Damaged or lost parcels","3":"Account and login problems"}},"angry":{"type":"noul","instructions":"Is the customer angry?"}}}'
```

**Not run in the earlier standalone server trial: installed-plugin OMP check.** After `/health` reports `ready`, in OMP with the installed extension loaded and without entering any key into chat, run:

```text
/statify status
/statify provider jeff
/statify on
/statify status
```

For a new profile, the first status should report Jev off; after these commands it should report Jeff in `replace` mode, the local endpoint, and server readiness. The native alternative is `/statify` → **Jeff · local (experimental)** → **Check connection**, then **Enable Jeff (experimental)**. No OpenRouter key is needed. If the server sets `JEFF_API_KEY`, use **Connection settings** or `/statify jeff-key add|edit` for masked entry; headless OMP prints an installed-manager terminal command targeting the active profile. Status reports key presence without printing it. `/statify jeff-url <url>` accepts only HTTP `127.0.0.1` with an explicit port. Once enabled, Jeff **can omit context immediately**. The [0.8B benchmark](benchmarks.md#paired-jev--local-jeff-08b-relevance-and-latency) documents one missed function line and one wrong model answer in the tested replay.

The observed health body was `{"status":"ready","model":"jeff-qwen3.5-0.8b","checkpoint":"checkpoints/jeff-0.8b","max_options":26,"authentication":false,"modalities":["text"]}`. `/v1/models` listed `jeff`, `jeff-latest`, `jeff-qwen3.5-0.8b` and `jeff-qwen3.8-27b`. The sample returned `answers.route.choice=\"2\"`, `answers.angry.noul=0.7537011132747267`, `usage.input_tokens=222` and `usage.output_tokens=0`. The trial's unchanged `statifyResult` request sent locally failed **422** for its `typesafe/jev-1.13` model id; with only the model id switched to `jeff-latest` in a diagnostic fetcher, the same parser returned real replacements for three source/history inputs. This is compatibility evidence, not accuracy validation; see the [trial results](jeff.md#local-trial-on-apple-m4).

The separately restarted, authenticated trial server returned `/health` `200` with `authentication:true`. **Verified 2026-09-29 on Apple M4/macOS 27.0: invalid-bearer check** against that server (`JEFF_API_KEY=dummy-key` in this throwaway trial): the request below returned `401` and `{"detail":"Missing or invalid API key."}`. Do not use `dummy-key` for a real service.

```sh
curl -si http://127.0.0.1:8765/v1/systemone -H 'Content-Type: application/json' -H 'Authorization: Bearer wrong-key' -d '{"model":"jeff-latest","state":"test","questions":{"q":{"type":"noul","instructions":"yes?"}}}'
```

**Not run: optional authenticated request.** First set `JEFF_API_KEY` on the server at startup and export the *same value* securely in the requesting terminal; do not put secrets in shared shell history. Then authenticate model and decision calls by adding this header (health remains public):

```sh
curl -sS -i http://127.0.0.1:8765/v1/models \
  -H "Authorization: Bearer ${JEFF_API_KEY:?export the server key first}"
```

A 401 means a missing/invalid bearer key; 422 means invalid request data (a historical unmodified Jev request with `typesafe/jev-1.13` failed this way); 503 means the model is not ready; 529 means another request holds Jeff's shared inference lock (`Retry-After: 1`). Statify's Jeff provider sends `jeff-latest`, checks `/health`, serializes local decisions, and fails open to original text on loading/unreachable health, 503/529/422, timeout or invalid answers. Successful standalone `curl` confirms the server route, **not Jeff's omission quality**; see [protocol compatibility](jeff.md#protocol-compatibility-with-statify).

### Run as a LaunchAgent

`brew services` manages Homebrew formulae, not this cloned Python server. This **optional alternative** LaunchAgent runs `jeff:serve` through `/opt/homebrew/bin/mise -C <absolute installed-plugin package directory>`, so the task supplies pinned uv without mise shell activation. Statify treats its reachable server as external and never stops it; do not start a duplicate managed or foreground server on the same port. After `jeff:setup`, replace `STATIFY_DIR` in the example with the absolute directory printed by `/statify jeff setup` (or an absolute source-checkout directory); keep `JEFF_DIR` aligned with setup if overridden. Logs live under `~/Library/Logs/Jeff`. The task binds only loopback and defaults to port 8765; add `JEFF_PORT` under `EnvironmentVariables` for another port and match the Statify endpoint. It sets no API key; to enable auth, add a protected `JEFF_API_KEY` under `EnvironmentVariables` and set the matching separate Statify Jeff key. Plists store environment values in plaintext: restrict permissions/backups and stop the service before editing. [launchd plist keys](https://keith.github.io/xcode-man-pages/launchd.plist.5.html).

**Historical source-checkout trial, partly verified 2026-09-29 on Apple M4/macOS 27.0:** the generated plist passed `plutil -lint`. Its `ProgramArguments` command, run in a launchd-like minimal environment (`env -i` with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`), reached `/health` `ready`. `launchctl` bootstrap/kickstart were **not run**; a plist pointing at an installed-plugin path was not separately tested.

```sh
STATIFY_DIR="/absolute/path/to/installed/omp-statify"  # Replace with the absolute path from /statify jeff setup.
JEFF_DIR="${JEFF_DIR:-$HOME/.local/share/omp-statify/jeff}"
JEFF_LOG="$HOME/Library/Logs/Jeff"
JEFF_PLIST="$HOME/Library/LaunchAgents/local.jeff.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$JEFF_LOG"
umask 077
cat > "$JEFF_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>local.jeff</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/mise</string>
    <string>-C</string><string>${STATIFY_DIR}</string>
    <string>run</string><string>jeff:serve</string>
  </array>
  <key>WorkingDirectory</key><string>${STATIFY_DIR}</string>
  <key>EnvironmentVariables</key><dict>
    <key>JEFF_DIR</key><string>${JEFF_DIR}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${JEFF_LOG}/stdout.log</string>
  <key>StandardErrorPath</key><string>${JEFF_LOG}/stderr.log</string>
</dict></plist>
PLIST
chmod 600 "$JEFF_PLIST"
plutil -lint "$JEFF_PLIST"
launchctl bootstrap "gui/$(id -u)" "$JEFF_PLIST"
launchctl kickstart -k "gui/$(id -u)/local.jeff"
```

**Not run: stop/reload.** Avoid starting a duplicate foreground Jeff process; inspect `~/Library/Logs/Jeff/stderr.log` if startup fails. `bootout` must precede another `bootstrap` when editing the plist.

```sh
JEFF_PLIST="$HOME/Library/LaunchAgents/local.jeff.plist"
launchctl bootout "gui/$(id -u)" "$JEFF_PLIST"
launchctl bootstrap "gui/$(id -u)" "$JEFF_PLIST"
```

### Remove

**Not run: uninstall.** Disable Jeff in Statify first to stop any managed server and prevent automatic startup, and stop any foreground server. If this LaunchAgent was loaded, stop it first; omit `bootout` when it was never loaded. Verify the chosen `JEFF_DIR` is expendable before recursively deleting it: removal includes `.venv`, weights and local Hugging Face download metadata.

```sh
JEFF_PLIST="$HOME/Library/LaunchAgents/local.jeff.plist"
launchctl bootout "gui/$(id -u)" "$JEFF_PLIST"
rm -f "$JEFF_PLIST"
rm -rf "$HOME/Library/Logs/Jeff"
rm -rf "${JEFF_DIR:-$HOME/.local/share/omp-statify/jeff}"
```

The default shared Hugging Face cache is `~/.cache/huggingface/hub` (and Xet content may be in `~/.cache/huggingface/xet`); inspect it before removing only this model's entries. **Not run: optional shared-cache deletion**—`uv cache clean` deletes the cache used by **all** uv projects, not just Jeff; do not run it for an ordinary Jeff uninstall. Supply the installed-plugin directory printed by `/statify jeff setup`:

```sh
mise -C '/absolute/path/to/installed/omp-statify' exec -- uv cache clean
```

## Generic engines via Homebrew

These are **generation** servers, not Jeff decision servers. Jeff's checkpoints store a fine-tuned backbone plus a separate trained 255-code `readout.safetensors` and fitted temperature in `decision_config.json` ([readout and inference](https://github.com/firelex/jeff/blob/db4a13d8db0dc9bd84100b97498620b5f396e25c/src/jeff/model.py#L163-L244)). Their ordinary causal-LM head is not the Jeff readout. Generated-token logprobs—even constrained to A/B, with a matching Qwen3.5 or Gemma 4 *base family*—cannot recreate Jeff's calibrated option probabilities without implementing its exact prompt, hidden-state readout and temperature. None exposes Jeff's `/v1/systemone` through its stock API; [Statify integration would need separate changes](jeff.md#protocol-compatibility-with-statify). All four options below were **not installed or run** in this research.

### llama.cpp

Homebrew **formula `llama.cpp` 0.5.0** (Metal on Apple Silicon); no formula service definition, so `brew services start llama.cpp` is not provided. `llama-server` defaults to port **8080**; its native `/completion` accepts `n_probs` and exposes top-token probabilities, and its OpenAI-style `/v1/chat/completions` is generation, not Jeff. This version supports conversion of ordinary Qwen3.5 and Gemma 4 **causal** models to GGUF, but the converter does not recognize Jeff's backbone-only model architecture or carry its trained readout. No Jeff drop-in. [Formula](https://formulae.brew.sh/formula/llama.cpp), [server API](https://github.com/ggml-org/llama.cpp/blob/v0.5.0/tools/server/README.md).

**Not run: install.** A server additionally needs a supported *non-Jeff* GGUF model; no model path is implied here.

```sh
brew install llama.cpp
```

### Ollama

Homebrew **formula `ollama` 0.34.4** supports `brew services`; default **11434**, native `/api/generate` or `/api/chat` and OpenAI-style `/v1/chat/completions`. Native `top_logprobs` is limited to **20**; its OpenAI logprobs support in [release notes](https://github.com/ollama/ollama/releases/tag/v0.12.11) conflicts with the current [compatibility checklist](https://docs.ollama.com/api/openai-compatibility), so verify that endpoint on the installed version. Official Qwen3.5 and Gemma 4 generation models are supported; a `qwen3.5:0.8b-mlx` pull is **not** a Jeff checkpoint. No Jeff drop-in. [Formula](https://formulae.brew.sh/formula/ollama).

**Not run: install, service and base-model download.**

```sh
brew install ollama
brew services start ollama
ollama pull qwen3.5:0.8b-mlx
curl -sS http://127.0.0.1:11434/api/tags
```

### MLX-LM

Homebrew **formula `mlx-lm` 0.31.3** (Homebrew `mlx` 0.32.1 and Python 3.14, distinct from Jeff's locked MLX); supports `brew services`. Server default **127.0.0.1:8080**, `/v1/chat/completions`; its `top_logprobs` hard maximum is **11** in 0.31.3. It includes ordinary text-generation Qwen3.5 and Gemma 4 loaders, not Jeff's independent trained readout. Jeff itself uses MLX-LM as a dependency, but **Jeff's custom backend/server**, not stock `mlx_lm.server`, handles decisions. No Jeff drop-in. [Formula](https://formulae.brew.sh/formula/mlx-lm), [server](https://github.com/ml-explore/mlx-lm/blob/v0.31.3/mlx_lm/server.py).

**Not run: install and service.** The formula service may download its default ordinary generation model; it is not a Jeff checkpoint.

```sh
brew install mlx-lm
brew services start mlx-lm
```

### LM Studio

Homebrew **cask `lm-studio` 0.4.25,1** (app 0.4.25, auto-updates); no Homebrew formula service. Open its GUI and start the Developer server; default **1234**, `/v1/chat/completions` and `/v1/responses`. Logprobs are available through `/v1/responses`, but no reliable numeric `top_logprobs` cap was documented. Available llama.cpp and MLX runtimes can handle *ordinary* Qwen3.5/Gemma 4 generation models with compatible runtime versions; this does not make Jeff's checkpoints loadable with the trained readout. No Jeff drop-in. [Cask](https://formulae.brew.sh/cask/lm-studio), [API](https://lmstudio.ai/docs/developer/openai-compat).

**Not run: install, GUI and HTTP check.** Start the server in LM Studio's Developer panel before querying.

```sh
brew install --cask lm-studio
open -a 'LM Studio'
curl -sS http://127.0.0.1:1234/v1/models
```

## Engine comparison

All versions are Homebrew metadata observed 2026-09-29; only the Jeff trial, if described above, used real inference on this M4. Family support in this table refers to **ordinary generation models**, not loading Jeff's decision weights.

| Server | Package / service | Local default API | Probability access | Qwen3.5 / Gemma 4 | Jeff checkpoint and decision API |
|---|---|---|---|---|---|
| Jeff | Pinned source via installed-plugin mise tasks; Statify-managed server or optional external LaunchAgent, not a Homebrew service | `127.0.0.1:8000` (task default `8765`), `/v1/systemone` | Decision probabilities from trained readout; task-specific calibration unproven | Qwen MLX/PyTorch; Gemma PyTorch only | Native Jeff; Statify defaults to risky `replace` after explicit provider selection and enablement |
| llama.cpp | Formula 0.5.0; no brew service | `:8080`, `/completion`, `/v1/chat/completions` | Top generated-token probabilities | Both after supported GGUF conversion | No |
| Ollama | Formula 0.34.4; brew service | `:11434`, `/api/generate`, `/v1/chat/completions` | Native logprobs, top 20; OpenAI support to verify | Both base families | No |
| MLX-LM | Formula 0.31.3; brew service | `:8080`, `/v1/chat/completions` | Generated-token `top_logprobs` ≤11 | Both text base families | No |
| LM Studio | Cask 0.4.25,1; no brew service | `:1234`, `/v1/chat/completions`, `/v1/responses` | `/v1/responses` logprobs; cap unverified | Both with compatible runtime/model | No |

## Sources

Accessed 2026-09-29. Jeff code and recipes: [README](https://github.com/firelex/jeff/blob/db4a13d8db0dc9bd84100b97498620b5f396e25c/README.md), [dependencies](https://github.com/firelex/jeff/blob/db4a13d8db0dc9bd84100b97498620b5f396e25c/pyproject.toml), [API](https://github.com/firelex/jeff/blob/db4a13d8db0dc9bd84100b97498620b5f396e25c/src/jeff/server.py), [backends](https://github.com/firelex/jeff/blob/db4a13d8db0dc9bd84100b97498620b5f396e25c/src/jeff/models.py). Model repositories: [0.8B](https://huggingface.co/mstrasser/Jeff-Qwen3.5-0.8B), [2B](https://huggingface.co/mstrasser/Jeff-Qwen3.5-2B), [Gemma](https://huggingface.co/mstrasser/Jeff-Gemma4-E2B). Setup and cleanup: [mise uv](https://mise.jdx.dev/lang/python.html#mise-uv), [Hugging Face CLI](https://huggingface.co/docs/huggingface_hub/guides/cli), [HF cache](https://huggingface.co/docs/huggingface_hub/guides/manage-cache), [uv cache](https://docs.astral.sh/uv/concepts/cache/), [Homebrew services](https://docs.brew.sh/Manpage.html#services-subcommand), [launchctl](https://keith.github.io/xcode-man-pages/launchctl.1.html). Engine package and API sources are linked in their subsections.
