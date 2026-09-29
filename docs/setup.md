# Install and use Statify

Install [OMP](https://github.com/can1357/oh-my-pi#install) and Bun, then install Statify as a plugin:

```sh
omp plugin install github:d3d0n/omp-statify
omp
```

OMP discovers the package's `src/index.ts` automatically from its plugin manifest. Do not also pass `--extension` or link it manually. After an npm release, `omp plugin install omp-statify` is an alternative. To develop from a checkout instead, run `mise install bun@1.4.2 && mise run install && mise run smoke`, then `omp --extension ./src/index.ts`; do not load the installed plugin simultaneously.

## Add a key and enable

Get an OpenRouter API key. In OMP, run `/statify key add`: it prints the **absolute** `bun ".../src/manage.ts" key add` command for your installed plugin. Run that command in an interactive terminal to enter the key without echo, then enable Statify in OMP:

```text
/statify on
/statify status
```

Alternatively, if installed directly as an npm CLI, use `statify key add`, `statify on`, and `statify status`. The CLI and OMP must use the same profile/agent directory.

`key add` reads the key with terminal echo disabled; **do not pass the key as a command argument**. Do not paste it into OMP chat: ordinary OMP text input does not mask secrets. The manager reports whether a key is set without printing it. Saving the key alone does **not** enable Statify or send tool output. Statify and its statusline start **off**; after `on`, the default mode is `replace`. It can send eligible tool results to OpenRouter's Jev decision API, so enable it only for data you are authorized to send. Secret detection is heuristic, not a guarantee; do not use it to sanitize private code. OMP's own OpenRouter login is independent of this key.

For one OMP session, explicitly select a different mode when launching:

```sh
omp --statify-mode=shadow
omp --statify-mode=record
```

`shadow` makes paid Jev requests without replacing context; `record` makes no Jev requests and changes nothing. Neither overrides the requirement to enable Statify for live sending. A normal launch uses `replace` after `on`. Eligible text from any tool, including shell output, and earlier plain-text assistant messages may be sent; user prompts and instruction messages are not rewritten. See [architecture](architecture.md) for size, privacy, and format limits.

## Manage or remove access

Use `/statify on|off|status|key remove|statusline on|statusline off` in OMP. To manage the key, use `/statify key add` to display the installed CLI path; run that path with `key add` or `key remove` in an interactive terminal. When `statify` is on your `PATH`, the equivalent commands are:

```sh
statify status
statify off
statify on
statify statusline on
statify statusline off
statify key remove
```

The change takes effect on the next tool result without restarting OMP; `off` cannot cancel a request already sent. `key remove` does not revoke the OpenRouter token: revoke it in your OpenRouter account if it was exposed or should no longer work.

The key is stored as plaintext, **not encrypted**, in the active OMP agent directory as `statify.key`; settings and statusline choice are in `statify.json`. Both files are written with mode `0600`. For the default profile this is `~/.omp/agent/`; an OMP profile or `PI_CODING_AGENT_DIR` changes the active directory. Run management commands with the same profile/environment as OMP so they target the same files; check `status` there if OMP appears to lack a key or remains off.

## Plugin loading

`omp plugin install github:d3d0n/omp-statify` installs and registers the extension in OMP's plugin directory; plugin installation is shared across profiles, while the Statify key and enabled setting belong to the active agent profile. Restart OMP after installation; `/statify status` confirms that the extension loaded. Avoid installing and explicitly loading the source file at the same time. `omp plugin uninstall omp-statify` removes the plugin; it does **not** revoke your OpenRouter key or delete Statify's settings/key files.
