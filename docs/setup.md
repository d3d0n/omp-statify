# Install and use Statify

Install [OMP](https://github.com/can1357/oh-my-pi#install) and Bun, then install Statify as a plugin:

```sh
omp plugin install github:d3d0n/omp-statify
omp
```

OMP discovers the package's `src/index.ts` automatically from its plugin manifest. Do not also pass `--extension` or link it manually. After an npm release, `omp plugin install omp-statify` is an alternative. To develop from a checkout instead, run `mise install bun@1.4.2 && mise run install && mise run smoke`, then `omp --extension ./src/index.ts`; do not load the installed plugin simultaneously.

## Interactive controls

Open `/statify` in OMP. The menu has four actions: **Jev · cloud**, **Jeff · local (experimental)**, **Enable/Disable Statify**, and **Show/Hide statusline**. Provider menus contain their setup and key controls. Escape goes back; Escape from the main menu closes it.

Filtering starts **off**. The statusline is visible by default for new profiles; an existing visibility choice is preserved. It shows the provider, active mode, and problems such as a missing key, a loading server, or an offline server. It updates on session/turn start and after controls are used; use Jeff's **Check connection** to refresh readiness while idle. A saved key is not proof that the provider accepts it.

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

1. Open `/statify` → **Jeff · local (experimental)** → **Install / setup Jeff**.
2. Choose **Install / update pinned Jeff**. Installation currently supports Apple Silicon macOS. If mise is missing, install it with `brew install mise` and retry; do **not** install uv or Python through Homebrew.
3. Inspect the absolute installed-plugin `mise.toml` named in the trust prompt. Approving explicitly trusts that file and runs its pinned installation tasks: mise installs uv, and uv installs Python, Jeff's locked dependencies, and the model. Canceling does not trust or install anything. A failed command stops installation and reports the failure; it never launches the server or enables filtering.
4. Run the displayed `jeff:serve` command in a **separate, persistent terminal** and keep it open. Statify never starts the server automatically.
5. Back in Jeff's menu, choose **Check connection**. Once the server is ready, choose **Enable Jeff (experimental)** and confirm the warning. No OpenRouter key is needed.

The installer uses the packaged `mise.toml` rather than requiring a Statify checkout or global Jeff/Python installation. It pins uv 0.12.19, Python 3.14, Jeff's server revision and the 0.8B model revision. The Jeff checkout lives under `${JEFF_DIR:-$HOME/.local/share/omp-statify/jeff}`; if overriding `JEFF_DIR`, keep the same environment for installation and serving.

**Connection settings** contains **Edit endpoint** and masked **Add/Edit/Remove API key** controls. The endpoint defaults to `http://127.0.0.1:8765`; only HTTP `127.0.0.1` with an explicit port is accepted. Jeff's key is optional unless the server was started with `JEFF_API_KEY`; in that case save the same key to this OMP profile. It is separate from Jev's OpenRouter key.

`/statify jeff setup` opens the installer in interactive OMP. The standalone `statify jeff setup` and headless/RPC command instead print absolute manual trust/install/serve instructions. `/statify jeff-key add|edit` opens masked entry in interactive OMP and gives a profile-scoped terminal fallback otherwise. `/statify provider jeff`, `/statify on`, and `/statify jeff-url <url>` remain direct command alternatives.

**Jeff is experimental:** in a [paired code test](benchmarks.md#paired-jev--local-jeff-08b-relevance-and-latency), Jeff 0.8B hid a required line and the main assistant gave an incorrect answer. Both providers use `replace` after explicit enablement unless a launch flag selects another mode. Archive recovery does not make omissions harmless. See [local inference](local-inference.md) for manual serving and cleanup and [Jeff research](jeff.md) for quality limits.

## Manage or remove access

Use `/statify` for setup, key management, enable/disable, and statusline visibility. `/statify status` shows detailed state without printing keys. Direct OMP commands remain available: `on|off`, `provider jev|jeff`, `key add|edit|remove`, `jeff-key add|edit|remove`, `jeff setup`, `jeff-url <url>`, and `statusline on|off`. When `statify` is on your `PATH`, equivalent terminal commands include:

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

`omp plugin install github:d3d0n/omp-statify#<tag>` installs and registers the extension in OMP's plugin directory; plugin installation is shared across profiles, while Statify settings and keys belong to the active agent profile. Restart OMP after installation; `/statify status` confirms that the extension loaded. Avoid installing and explicitly loading the source file at the same time. `omp plugin uninstall omp-statify` removes the plugin; it does **not** stop a separately running Jeff server, revoke an OpenRouter key, or delete Statify's settings/key files. Stop Jeff in its serving terminal; inspect the Jeff directory and shared caches before removing downloaded data as described in [local inference cleanup](local-inference.md#remove).
