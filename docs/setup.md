# Install and use Statify

Install [OMP](https://github.com/can1357/oh-my-pi#install) and Bun, then install Statify as a plugin:

```sh
omp plugin install github:d3d0n/omp-statify
omp
```

OMP discovers the package's `src/index.ts` automatically from its plugin manifest. Do not also pass `--extension` or link it manually. After an npm release, `omp plugin install omp-statify` is an alternative. To develop from a checkout instead, run `mise install bun@1.4.2 && mise run install && mise run smoke`, then `omp --extension ./src/index.ts`; do not load the installed plugin simultaneously.

## Jev: add an OpenRouter key and enable

Get an OpenRouter API key. In OMP, run `/statify key add`: it prints the **absolute** `bun ".../src/manage.ts" key add` command for your installed plugin. Run that command in an interactive terminal to enter the key without echo, then enable Statify in OMP:

```text
/statify on
/statify status
```

Alternatively, if installed directly as an npm CLI, use `statify key add`, `statify on`, and `statify status`. The CLI and OMP must use the same profile/agent directory.

`key add` reads the key with terminal echo disabled; **do not pass the key as a command argument**. Do not paste it into OMP chat: ordinary OMP text input does not mask secrets. The manager reports whether a key is set without printing it. Saving the key alone does **not** enable Statify or send tool output. Statify and its statusline start **off**; Jev is the default provider and after `on` its default mode is `replace`. It can send eligible tool results to OpenRouter's Jev decision API, so enable it only for data you are authorized to send. Secret detection is heuristic, not a guarantee; do not use it to sanitize private code. OMP's own OpenRouter login is independent of this key.

For one OMP session, explicitly select a different mode when launching:

```sh
omp --statify-mode=shadow
omp --statify-mode=record
```

`shadow` makes Jev requests without replacing context; `record` makes no provider requests and changes nothing. Neither overrides the requirement to enable Statify for live sending. A normal Jev launch uses `replace` after `on`. Eligible text from any tool, including shell output, and earlier plain-text assistant messages may be sent; user prompts and instruction messages are not rewritten. See [architecture](architecture.md) for size, privacy, and format limits.

## Jeff: experimental local provider

On Apple Silicon, install mise with Homebrew (`brew install mise`); do **not** install uv or Python via Homebrew for Jeff. Install the plugin with `omp plugin install github:d3d0n/omp-statify#<tag>` (replace `<tag>` with a released tag), launch `omp`, and run `/statify jeff setup`. It prints **absolute installed-plugin** `mise -C '<installed-plugin-directory>' install uv`, `mise -C '<installed-plugin-directory>' run jeff:setup`, and `mise -C '<installed-plugin-directory>' run jeff:serve` terminal commands. Copy these commands as printed; do not substitute your current directory or assume a source checkout. The published plugin contains `mise.toml`, which pins uv 0.12.19; uv pins Python 3.14 and Jeff's locked dependencies, downloads the pinned model, and keeps the Jeff checkout under `${JEFF_DIR:-$HOME/.local/share/omp-statify/jeff}`.

Run the printed `mise trust '<installed-plugin-directory>/mise.toml'` command **first**, after confirming you trust the installed plugin. Packaged mise tasks can be rejected as untrusted without this explicit step.

Run `jeff:setup` once. Start `jeff:serve` in a **separate terminal** and keep it running (the server is not installed globally or auto-started by OMP). Wait for `curl -sS http://127.0.0.1:8765/health` to return `"status":"ready"`, then in OMP:

```text
/statify provider jeff
/statify on
/statify status
```

`provider jeff` alone does not enable Statify. Jeff uses loopback HTTP only, default `http://127.0.0.1:8765`; `/statify jeff-url <url>` changes the endpoint to another explicit `127.0.0.1` HTTP port. No OpenRouter key is needed for Jeff. If the server is started with `JEFF_API_KEY`, add its matching optional profile-scoped key with `statify jeff-key add` in an interactive terminal; `/statify jeff-key add` prints the absolute installed-plugin terminal command. Never enter keys into OMP chat. **`/statify on` now starts Jeff in `replace` by default**; no launch override is needed. This is risky: in a [paired public-code benchmark](benchmarks.md#paired-jev--local-jeff-08b-relevance-and-latency) Jeff 0.8B hid the needed function line and the main model answered incorrectly. Choose `--statify-mode=shadow` explicitly only when diagnosing classifications without omissions. Original-text archive recovery, secret-pattern bypass and fail-open errors do not guarantee correct omissions. See [local inference](local-inference.md) and [Jeff research](jeff.md).

## Manage or remove access

Use `/statify on|off|status|provider jev|provider jeff|jeff setup|jeff-key add|jeff-key remove|key remove|statusline on|statusline off` in OMP. To manage keys, `/statify key add` or `/statify jeff-key add` displays an installed CLI path; run the corresponding terminal command interactively. When `statify` is on your `PATH`, the equivalent commands include:

```sh
statify status
statify off
statify on
statify statusline on
statify statusline off
statify key remove
statify provider jev
statify provider jeff
statify jeff-key add
statify jeff-key remove
```

The change takes effect on the next tool result without restarting OMP; `off` cannot cancel a request already sent. `key remove` only removes the Jev OpenRouter key and does **not** disable Jeff; `jeff-key remove` removes only Jeff's optional local key. Neither revokes a server-side token: rotate it at the provider/server if exposed.

Keys are plaintext, **not encrypted**, in the active OMP agent directory: `statify.key` for Jev and `statify-jeff.key` for Jeff; settings, provider, endpoint, and statusline choice are in `statify.json`. Key files are written with mode `0600`. For the default profile this is `~/.omp/agent/`; an OMP profile or `PI_CODING_AGENT_DIR` changes the active directory. Run management commands with the same profile/environment as OMP so they target the same files; check `status` there if OMP appears to lack a key or remains off.

## Plugin loading

`omp plugin install github:d3d0n/omp-statify#<tag>` installs and registers the extension in OMP's plugin directory; plugin installation is shared across profiles, while Statify settings and keys belong to the active agent profile. Restart OMP after installation; `/statify status` confirms that the extension loaded. Avoid installing and explicitly loading the source file at the same time. `omp plugin uninstall omp-statify` removes the plugin; it does **not** stop a separately running Jeff server, revoke an OpenRouter key, or delete Statify's settings/key files. Stop Jeff in its serving terminal; inspect the Jeff directory and shared caches before removing downloaded data as described in [local inference cleanup](local-inference.md#remove).
