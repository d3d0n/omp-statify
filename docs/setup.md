# Install and use Statify

Statify is a source extension for [Oh-my-pi (OMP)](https://github.com/can1357/oh-my-pi), not a published OMP package. Install the OMP CLI using its [official instructions](https://github.com/can1357/oh-my-pi#install), and install [mise](https://mise.jdx.dev/getting-started.html). From a checkout of this repository:

```sh
mise install bun@1.4.2
mise run install
mise run smoke
```

The smoke task starts OMP with the extension and checks it loaded; it makes no Statify API request. OMP is installed separately from these dependencies. Start from the repository root, using either the explicit extension flag below or the optional symlink later in this guide.

## Add a key and enable

Get an OpenRouter API key, then run the manager from an interactive terminal in the repository root:

```sh
bun src/manage.ts status
bun src/manage.ts key add
bun src/manage.ts status
bun src/manage.ts on
omp --extension ./src/index.ts
```

`key add` reads the key with terminal echo disabled; **do not pass the key as a command argument**. Do not paste it into OMP chat: ordinary OMP text input does not mask secrets. The manager reports whether a key is set without printing it. Saving the key alone does **not** enable Statify or send tool output. Statify and its statusline start **off**; after `on`, the default mode is `replace`. It can send eligible tool results to OpenRouter's Jev decision API, so enable it only for data you are authorized to send. Secret detection is heuristic, not a guarantee; do not use it to sanitize private code. OMP's own OpenRouter login is independent of this key.

For one OMP session, explicitly select a different mode when launching:

```sh
omp --extension ./src/index.ts --statify-mode=shadow
omp --extension ./src/index.ts --statify-mode=record
```

`shadow` makes paid Jev requests without replacing tool output; `record` makes no Jev requests and does not replace tool output. Neither overrides the requirement to enable Statify for live sending. A normal launch uses `replace` after `on`. The extension handles eligible text from `read` and `grep`, not all tools; see [architecture](architecture.md) for limits.

## Manage or remove access

Run these in the repository root:

```sh
bun src/manage.ts status
bun src/manage.ts off                 # stop future Statify requests; keep key
bun src/manage.ts on
bun src/manage.ts statusline on       # optional OMP TUI indicator
bun src/manage.ts statusline off
bun src/manage.ts key remove         # remove Statify key and disable Statify
```

The change takes effect on the next tool result without restarting OMP; `off` cannot cancel a request already sent. `key remove` does not revoke the OpenRouter token: revoke it in your OpenRouter account if it was exposed or should no longer work.

The key is stored as plaintext, **not encrypted**, in the active OMP agent directory as `statify.key`; settings and statusline choice are in `statify.json`. Both files are written with mode `0600`. For the default profile this is `~/.omp/agent/`; an OMP profile or `PI_CODING_AGENT_DIR` changes the active directory. Run management commands with the same profile/environment as OMP so they target the same files; check `status` there if OMP appears to lack a key or remains off.

## Optional extension discovery and TUI

For OMP's default profile, you can create a symlink once from the repository root:

```sh
mkdir -p ~/.omp/agent/extensions
ln -s "$PWD/src/index.ts" ~/.omp/agent/extensions/statify.ts
omp
```

For another profile, place the symlink in **that profile's** `agent/extensions` directory instead. When OMP auto-discovers the symlink, omit `--extension`: do not load the same module twice. Without auto-discovery, start OMP using `omp --extension ./src/index.ts` from this repository. A missing `/statify` command or UI indicator usually means the extension was not loaded; check the launch path, active profile, and whether the optional statusline is on. The extension works without a TUI.

In interactive OMP, `/statify` opens an optional menu; `/statify on`, `/statify off`, `/statify status`, `/statify key remove`, `/statify statusline on`, and `/statify statusline off` are also available. **Add** a key only through `bun src/manage.ts key add` in a terminal; the TUI cannot safely mask key entry.
