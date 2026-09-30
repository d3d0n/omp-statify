# Install and use Statify

Install [OMP](https://github.com/can1357/oh-my-pi#install) and Bun, then install Statify as a plugin:

```sh
omp plugin install github:d3d0n/omp-statify
omp
```

OMP discovers the package's `src/index.ts` automatically from its plugin manifest. Do not also pass `--extension` or link it manually. After an npm release, `omp plugin install omp-statify` is an alternative. To develop from a checkout instead, run `mise install bun@1.4.2 && mise run install && mise run smoke`, then `omp --extension ./src/index.ts`; do not load the installed plugin simultaneously.

## Interactive controls

Open `/statify` in OMP. The menu has four actions: **Jev · cloud**, **Jeff · local (experimental)**, **Enable/Disable Statify**, and **Show/Hide statusline**. Provider menus contain their setup and key controls. After an action, the cursor stays on the chosen item; if that item disappears, it stays at the nearest available position. This applies to the main, provider, and connection-settings menus. Escape goes back; Escape from the main menu closes it.

Filtering starts **off**. The statusline is visible by default for new profiles; an existing visibility choice is preserved. Its format is `<icon> Statify · <provider> · <segments>`, with provider `Jev` or `Jeff <short>` (`Jeff 0.8B`, `Jeff 0.8B v1.1`, or `Jeff 2B`). `●` means active, `◐` means starting/loading or processing a request, `!` means attention is needed, and `○` means off or record mode. It shows the mode (`replace`, `shadow`, or `record`), missing-key or invalid-mode warnings, and Jeff's server state (`ready`, `loading`, `starting`, `stopped`, `failed`, or `not installed`). An external server appears as ready. While requests are in flight, `classifying` replaces the active mode, with `classifying ×N` for multiple requests.

When Jeff is enabled in `replace` or `shadow` but not ready, the statusline shows `· paused`: originals are kept. If the environment exists but the selected model is missing, it shows `model not downloaded · paused`. A managed startup shows elapsed seconds, updated every second; a blocked start shows `port N busy`. A background model download appends `· ↓ <short> <pct>%` in any state, refreshed every second.

After a completed provider request, `last −<saved> tok` shows tokens saved by the latest replacement, `last kept` means no replacement (including shadow mode), and `last error` means the request failed. Every `last` segment appends `(<used> used)` when classifier input+output usage is known: for example, `last −1.6k tok (2.1k used)`, `last kept (493 used)`, or `last error (493 used)` when the provider returned usage. `Σ −<saved>` shows saved tokens for this session when positive; the total is restored on `/resume` or after restarting OMP, while `/new` starts at zero. Counts use integers below 1,000, then compact `k`/`M` units. Bypassed output does not affect these stats; statusline stats are hidden when off or in record mode.

Jeff reports input-token usage (output tokens are zero), so `(<used> used)` appears for Jeff too.

`/statify status` includes `This session: <requests> requests · saved <saved> tokens · classifier used <used> · replaced <replaced>, kept <kept>, errors <errors>`. Requests count completed provider requests, excluding bypasses; saved is the token reduction from replacements, and classifier used is reported input+output usage across Jev and Jeff. Replaced counts replacements, kept counts no-op or shadow results, and errors counts API errors. Token totals use the same compact formatting as the statusline.

Examples:

```text
○ Statify · Jev · off
● Statify · Jev · replace · last −1.6k tok (2.1k used) · Σ −8.4k
◐ Statify · Jeff 0.8B · server starting 4s · paused
! Statify · Jeff 0.8B · server stopped · paused
! Statify · Jeff 0.8B · server failed · paused
! Statify · Jeff 0.8B · not installed · paused
! Statify · Jeff 0.8B · port 8765 busy · paused
! Statify · Jeff 2B · model not downloaded · paused
○ Statify · Jeff 0.8B · off · ↓ 2B 43%
● Statify · Jeff 0.8B · server ready · replace · last −920 tok (493 used) · Σ −3.1k
```

The statusline updates on session/turn start, after controls and provider requests, while a managed server starts, and while a model downloads. Jeff's **Check connection** refreshes readiness while idle; the result stays visible in the Jeff menu title and item, and the cursor stays on **Check connection**. A saved key is not proof that the provider accepts it.

## Jev: add an OpenRouter key and enable

1. Open `/statify` → **Jev · cloud**.
2. Create a separate [OpenRouter API key](https://openrouter.ai/settings/keys). **Get an OpenRouter key** in the menu shows the same link; Jev needs no local model installation.
3. Choose **Add API key** and paste it into the masked dialog. Enter saves; Escape cancels. Empty input leaves an existing key unchanged.
4. Choose **Enable Jev** and confirm that this profile's data may be sent to OpenRouter.

Once a key is saved, the menu offers **Edit API key** and **Remove API key**. Editing does not preload or display the old key. Removing the Jev key disables Statify if Jev is selected; it does not disable Jeff.

`/statify key add` and `/statify key edit` open the same masked dialog in interactive OMP. In headless/RPC mode, they print a safely quoted terminal command targeting the active profile. The standalone CLI supports `statify key add|edit|remove`; add/edit read a hidden terminal prompt or stdin, never a key argument. Keep the CLI and OMP on the same profile.

Saving a key alone does **not** turn Statify on. Keys are stored locally as plaintext, **not encrypted**. Never paste secrets into ordinary OMP chat. OMP's own OpenRouter login is independent of this key. Enable Jev only for data you may send to OpenRouter; secret detection is heuristic, not a guarantee or a way to sanitize private code.

For one OMP session, explicitly select a different mode when launching:

```sh
omp --statify-mode=shadow
omp --statify-mode=record
```

`shadow` makes Jev requests without replacing context; `record` makes no provider requests and changes nothing. Neither overrides the requirement to enable Statify for live sending. A normal Jev launch uses `replace` after `on`. Eligible text from any tool, including shell output, and earlier plain-text assistant messages may be sent; user prompts and instruction messages are not rewritten. See [architecture](architecture.md) for size, privacy, and format limits.

## Jeff: experimental local provider

1. Open `/statify` → **Jeff · local (experimental)** → **Install / update Jeff**.
2. Installation currently supports Apple Silicon macOS. If mise is missing, install it with `brew install mise` and retry; do **not** install uv or Python through Homebrew.
3. Inspect the absolute installed-plugin `mise.toml` named in the trust prompt. Approving explicitly trusts that file and runs its pinned installation tasks: mise installs uv, and uv installs Python, Jeff's locked dependencies, and the model. Canceling does not trust or install anything. A failed command stops installation and reports the failure with the setup log path; installation alone does not enable filtering.
4. Choose **Enable Jeff (experimental)** and confirm. Statify starts the installed local server in the background and reports when it is ready. No separate terminal or OpenRouter key is needed.

> **One session at a time.** Jeff runs one decision request at a time and immediately rejects concurrent requests as busy (HTTP 529); Statify does not retry them and passes that output through unchanged. Within one OMP session, Statify queues its own Jeff requests, so a single session works as expected. Several OMP sessions sharing one Jeff server interfere with each other and filter noticeably less. Use Jev when running OMP sessions in parallel.

When enabled in `replace` or `shadow` mode, Jeff starts automatically on OMP session startup if no server is reachable. Disabling Statify/Jeff or switching to Jev stops the managed server; closing the last OMP window using the profile also stops it. A successful install/update while Jeff is enabled restarts it. A server started outside Statify is external and is **never stopped by Statify**.

While Jeff is enabled, its menu offers **Start server**, **Stop server**, and **Restart server** as appropriate. Stopping the server keeps Jeff selected; output stays unchanged until you start it again. **Check connection** reports readiness. **Logs** opens the server and setup log tails, each headed by its absolute path. If startup fails or takes more than two minutes, Statify points you to the logs.

Logs live in the active profile directory (`~/.omp/agent/` by default, or `PI_CODING_AGENT_DIR`): `statify-jeff-server.log` contains server output and is replaced at each start; `statify-jeff-setup.log` contains the sanitized installer transcript and is replaced at each install attempt. Model downloads append `== Download <label> <ISO time> ==` sections to that same setup log. These files use mode `0600`. Server ownership is recorded in `statify-jeff-server.json`; `statify-jeff-leases/` tracks OMP windows sharing the profile. `/statify status` includes server state (and the managed server's PID), the selected model and whether it is downloaded, download progress when running, and both log paths. If setup, a download, or the server fails, ask OMP “why did Statify setup fail?” — the bundled **statify-troubleshooting** skill reads these logs and OMP's logs.

The installer uses the packaged `mise.toml` rather than requiring a Statify checkout or global Jeff/Python installation. It pins uv 0.12.19, Python 3.14, Jeff's server revision and the 0.8B model revision. The Jeff checkout lives under `${JEFF_DIR:-$HOME/.local/share/omp-statify/jeff}`; if overriding `JEFF_DIR`, keep the same environment for installation and serving.

**Servers & ports**, after **Check connection**, lists discovered running Jeff servers with their port, `ready`/`loading` state, and **this profile** or **external** label (plus process details when available). The current endpoint has a check mark; selecting a server connects to it. **Random free port** selects an unused local port and starts a managed server when Jeff is enabled; **Enter endpoint…** accepts a local address. The submenu preserves the cursor after actions.

**Models**, directly after **Servers & ports**, shows the active model and how many models are downloaded, or the current download's progress. Its submenu has one row each for **Jeff 0.8B v1.0** (default, tested with Statify), **Jeff 0.8B v1.1** (better calibrated, not yet tested with Statify), and **Jeff 2B v1.1** (more accurate on benchmarks, about twice as slow and 2.6 times the memory). Rows show an active-model check mark, `downloaded`, `not downloaded`, or `downloading <pct>%`, download size (1.7 GB or 4.4 GB), and a model note. The model and action menus preserve the cursor and include **Back**.

Select a row for **Download (<size>)**, **Cancel download**, **Use this model**, **Delete (frees <size on disk>)**, or **Delete partial files (<size on disk>)**, as applicable. Downloads and deletion ask confirmation. The active model cannot be deleted. Only one model download runs at a time per OMP process; another model's action menu says **Another download is running** instead of offering destructive actions. Incomplete downloads resume with **Download**; cancellation or OMP shutdown keeps partial files. Finishing a download does not select it automatically: choose **Use this model** afterward.

Switching models saves the selection and restarts a Statify-managed server, or starts one when Jeff is enabled and no server is running. External servers keep whatever model they already run; Statify does not restart them. Models live in `<jeffDir>/checkpoints/<id>` with IDs `jeff-0.8b`, `jeff-0.8b-v1.1`, and `jeff-2b-v1.1`.

Before starting on an occupied port, an explicit interactive action offers **Use a random free port**, **Choose a running Jeff server** (when any are found), or **Cancel**. Automatic session startup and headless commands instead warn without starting; open **Servers & ports** or use `/statify jeff-url random`.

**Reinstall Jeff** is available when Jeff is installed or the server failed, and is offered after server failures. It asks confirmation before deleting only `<jeffDir>/.venv` and the active model's `<jeffDir>/checkpoints/<id>` directory, then runs the pinned installation again and downloads the active model if it is not the default. The checkout, other model directories, and shared caches are not removed. Statify stops its managed server first and starts it after a successful reinstall when Jeff is enabled.

While running, server logs above 1 MiB are trimmed to the last 256 KiB, starting at a full line, with a `[statify: log trimmed at <ISO time>]` marker. This expected notice is not an error.

**Connection settings** contains **Edit endpoint** and masked **Add/Edit/Remove API key** controls. The endpoint defaults to `http://127.0.0.1:8765`; only HTTP `127.0.0.1` with an explicit port is accepted. Changing the endpoint saves it: if Jeff already serves the new address, Statify stops this profile's managed server on a different address and connects without starting another; otherwise it restarts a managed server from a different address, or starts one when Jeff is enabled in `replace`/`shadow`. External servers are never stopped. Jeff's key is optional unless the server was started with `JEFF_API_KEY`; in that case save the same key to this OMP profile. It is separate from Jev's OpenRouter key.

`/statify jeff setup` opens the installer in interactive OMP. The standalone `statify jeff setup` and headless/RPC command instead print absolute manual trust/install/serve instructions: review and run the printed trust, uv installation, and `jeff:setup` commands, then return to OMP and enable Jeff for managed background serving (or run `statify provider jeff && statify on` for the same profile). OMP starts the server automatically and stops it when Jeff is disabled or the last OMP session exits. The printed foreground serve command is an optional manual alternative; for a nondefault port, set `JEFF_PORT` to the port in the configured endpoint (default `8765`). Statify does not stop this external server.

`/statify jeff start|stop|restart|logs` provides direct server controls in interactive or headless/RPC OMP; `logs` reports the last 20 lines and log paths. `/statify jeff-key add|edit` opens masked entry in interactive OMP and gives a profile-scoped terminal fallback otherwise. `/statify provider jeff`, `/statify on`, and `/statify jeff-url <url>` remain direct command alternatives.

For interactive or headless/RPC OMP, `/statify jeff servers` lists running Jeff servers and `/statify jeff-url random` selects a free port (and starts Jeff when enabled). `/statify jeff-url <url>` uses the same endpoint-change behavior as the menu.

In interactive or headless/RPC OMP, `/statify jeff models` lists each model's ID, label, and downloaded/active state; `/statify jeff model <id>` selects a downloaded model using the same server restart rules; `/statify jeff download <id>` starts a background download. These are OMP commands, not standalone terminal CLI commands.

Jeff is experimental. See the [paired code test](benchmarks.md#paired-jev--local-jeff-08b-relevance-and-latency) and [Jeff research](jeff.md) for evaluation results and limitations. Both providers use `replace` after explicit enablement unless a launch flag selects another mode. See [local inference](local-inference.md) for manual serving and cleanup.

## Manage or remove access

Use `/statify` for setup, key management, enable/disable, and statusline visibility. `/statify status` shows detailed state without printing keys. Direct OMP commands remain available: `on|off`, `provider jev|jeff`, `key add|edit|remove`, `jeff-key add|edit|remove`, `jeff setup|start|stop|restart|logs|servers|models`, `jeff model <id>`, `jeff download <id>`, `jeff-url <url>|random`, and `statusline on|off`. When `statify` is on your `PATH`, terminal management commands include:

```sh
statify status
statify off
statify on
statify statusline on
statify statusline off
statify key add
statify key edit
statify key remove
statify provider jev
statify provider jeff
statify jeff-key add
statify jeff-key edit
statify jeff setup
statify jeff-key remove
```

The change takes effect on the next tool result without restarting OMP; `off` cannot cancel a request already sent. `key remove` only removes the Jev OpenRouter key and does **not** disable Jeff; `jeff-key remove` removes only Jeff's optional local key. Neither revokes a server-side token: rotate it at the provider/server if exposed.

Keys are plaintext, **not encrypted**, in the active OMP agent directory: `statify.key` for Jev and `statify-jeff.key` for Jeff; settings, provider, endpoint, and statusline choice are in `statify.json`. Key files are written with mode `0600`. For the default profile this is `~/.omp/agent/`; an OMP profile or `PI_CODING_AGENT_DIR` changes the active directory. Run management commands with the same profile/environment as OMP so they target the same files; check `status` there if OMP appears to lack a key or remains off.

## Plugin loading

`omp plugin install github:d3d0n/omp-statify#<tag>` installs and registers the extension in OMP's plugin directory; plugin installation is shared across profiles, while Statify settings and keys belong to the active agent profile. Restart OMP after installation; `/statify status` confirms that the extension loaded. Avoid installing and explicitly loading the source file at the same time. Before uninstalling, disable Jeff or use `/statify jeff stop` to stop the managed server. `omp plugin uninstall omp-statify` removes the plugin; it does **not** stop an external Jeff server, revoke an OpenRouter key, or delete Statify's settings/key files. Stop an optional manually served Jeff instance yourself; inspect the Jeff directory and shared caches before removing downloaded data as described in [local inference cleanup](local-inference.md#remove).
