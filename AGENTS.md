# Repository Guidelines

## Project Overview

`omp-statify` is a Bun/TypeScript Oh-my-pi (OMP) extension. With explicit opt-in, it asks Jev through OpenRouter (requires a separate key) or experimental locally served Jeff (no OpenRouter key) to select useful chunks from large tool results and earlier plain-text assistant context. It keeps exact originals locally for recovery; it does not rewrite user prompts or instructions. It starts disabled; both providers default to `replace` after explicit enablement. Jeff 0.8B omitted a required function line in a paired public-code benchmark and the main model answered incorrectly; keep that warning visible. See `README.md`, `docs/architecture.md`, and `docs/benchmarks.md` before changing filtering or privacy behavior.

## Architecture & Data Flow

- `src/index.ts` exports the OMP extension. `session_start`/`turn_start` refresh state; `tool_result` processes eligible text blocks; `context` processes eligible earlier single-text-block assistant messages. The latest user task supplies classification context. Never filter recovery-tool output.
- Eligible text is split on preferred structural/line boundaries into near-equal chunks of about 1,000 tokens in the classifier's tokenizer (Jev or Qwen 3.5); the chunk count follows from the output size. Default Jev calls OpenRouter; experimental Jeff calls a loopback server managed by Statify or started externally. Uncertain answers, failed requests, bypasses, and replacements that do not reduce both characters and estimated tokens retain the original. `record` preserves text without network calls; `shadow` explicitly classifies without replacing for diagnostics; `replace` is the default for either provider after `on` and can omit text.
- Before a `replace` request, the original is archived. Receipts name the archive with a three-word ID and mark each omitted range in place with **1-based inclusive UTF-16 offsets**; the registered `xd://statify_read` tool retrieves exact archived spans (at most 8,000 UTF-16 units). File-backed sessions use a `.statify` directory beside the session; ephemeral archives are cleaned on shutdown.
- `src/settings.ts` owns profile-scoped settings/key persistence shared by the extension and `src/manage.ts` CLI. The extension uses session-scoped archives and a bounded promise cache for assistant-context classification. Keep fail-open behavior for classification, but do not silently accept corrupt settings or insecure keys.
- `src/jeff-server.ts` owns managed Jeff server lifecycle, logs, and profile-scoped process leases. Explicit enablement and session startup can start installed Jeff in `replace`/`shadow`; disable/provider changes and the last session shutdown stop the managed server. Never stop external servers; verify recorded PID and start time before signaling.

## Key Directories

- `src/`: extension, management CLI, shared settings/key storage.
- `tests/`: Bun behavior tests for filtering/recovery, settings/CLI, and benchmarks.
- `bench/`: RepoQA case preparation (`cases.ts`) and offline/live benchmark runner (`run.ts`).
- `docs/`: setup, architecture/privacy limits, benchmark methodology, and Jeff/local-inference research.
- `skills/`: bundled `statify-troubleshooting` skill for setup/runtime diagnosis from sanitized installer, server, and OMP logs.

## Development Commands

```sh
mise install bun@1.4.2
mise run install       # bun install --frozen-lockfile
mise run check         # bunx biome check .
mise run typecheck     # bunx tsc --noEmit
mise run test          # bun test
mise run smoke         # launches OMP RPC and verifies extension/recovery-tool loading
omp --extension ./src/index.ts  # local development; do not also load installed plugin
bun src/manage.ts status
bun bench/run.ts --limit 1       # offline synthetic benchmark
mise install && mise run jeff:setup  # source checkout: pinned uv/Python/locked Jeff dependencies
mise run jeff:serve                  # optional manual foreground server; JEFF_PORT defaults to 8765
```

`package.json` has no scripts or build step; TypeScript is checked with `noEmit`. The live benchmark requires `--live --jev-only` or `--live --model provider/model-id` plus `OPENROUTER_API_KEY`; read `docs/benchmarks.md` before using provider calls.

## Code Conventions & Common Patterns

- Strict ESM TypeScript (`tsconfig.json`); tab indentation and double-quoted strings as in `src/`. Use `node:*` filesystem/crypto/path utilities and async/await for I/O. Run Biome rather than inventing another formatter.
- Keep OMP integration in the default `statify(pi)` export; factor shared profile persistence through `src/settings.ts`. Use small typed helpers and injectable `fetcher`/callbacks for deterministic tests, not global network mocks.
- On missing settings/key files, use disabled defaults; reject malformed settings, non-regular or permissive key files. Write sensitive files atomically with `0600` permissions. Bypass risky/unsupported inputs and preserve original model-visible text on Jev or token-estimate failure.
- Preserve UTF-16/surrogate boundaries, receipt provenance, and archive-before-network ordering when changing chunking or replacement. Cache only within a session; clean ephemeral artifacts.

## Important Files

- `package.json`: OMP extension manifest (`./src/index.ts`), `statify` bin (`./src/manage.ts`), published-file allowlist and dependencies.
- `src/index.ts`: hooks, Jev filtering, archives, recovery tool, session lifecycle.
- `src/settings.ts`, `src/manage.ts`: profile settings/key and CLI management.
- `src/jeff-server.ts`: managed Jeff server lifecycle, server/setup log access, ownership records, and process leases.
- `mise.toml`, `tsconfig.json`, `bun.lock`: task commands, strict no-emit compiler options, locked dependencies.
- `docs/architecture.md`, `docs/setup.md`, `docs/benchmarks.md`: behavioral/privacy contract, local loading, evidence limitations.
- `docs/jeff.md`, `docs/local-inference.md`: dated Jeff research and macOS inference details; Jeff is now selectable experimentally, but published benchmarks are not quality validation for Statify.

## Runtime/Tooling Preferences

- Use Bun 1.4.2 via `mise.toml` (package minimum `>=1.4.2`), Bun's frozen lockfile install, and OMP for extension execution. Do not assume Node/npm scripts or transpiled build output.
- Python tooling (experimental Jeff tasks only): Homebrew installs mise on Apple Silicon; mise installs just `uv` (pinned in published `mise.toml`); uv pins Python (`uv python pin`) and dependencies (`uv sync --locked`). Do not install uv or Python through Homebrew; Homebrew is for inference engines. `/statify jeff setup` runs the interactive installer with no source checkout required; enabling Jeff starts the installed server in the background. Manual `jeff:serve` is optional; set `JEFF_PORT` for a nondefault endpoint and check `/health` ready.
- Packaged mise configs may be untrusted in `node_modules`; the interactive installer requires explicit approval of the absolute installed-plugin `mise.toml`. Standalone `statify jeff setup` and headless/RPC setup print a `mise trust <absolute-mise.toml>` command before manual install/serve instructions. The user must decide to trust the installed plugin; do not bypass trust automatically.
- Installed plugin discovery loads `src/index.ts` automatically; local `omp --extension ./src/index.ts` is an alternative, not an additional loading path. Settings and separate plaintext Jev/Jeff keys live in the active OMP agent/profile directory (`PI_CODING_AGENT_DIR` can override it); do not print keys or enable external transmission without consent. Jeff's local data and untrusted inputs still require care; its default `replace` is experimental and has a measured false omission.

## Testing & QA

- `bun:test` suites: `tests/statify.test.ts`, `tests/settings.test.ts`, `tests/bench.test.ts`, `tests/jeff-server.test.ts`, `tests/key-input.test.ts`. Use temp directories removed in `afterEach`/`finally`, injected `fetcher` returning `Response`, and isolated `PI_CODING_AGENT_DIR` for CLI subprocesses.
- Cover observable boundaries: exact archive recovery and receipt ranges, preservation of relevant/uncertain text, archive durability before requests, security of key storage, and benchmark scoring/error/bypass behavior. `mise run smoke` checks real OMP RPC extension loading; it does not replace behavior tests.
- Benchmarks can involve external provider calls and pinned public RepoQA inputs; offline synthetic mode is the default. See `bench/run.ts` and `docs/benchmarks.md` for live limits and cost/quality caveats; no universal coverage threshold is configured.
