# omp-statify

[![Stars](https://img.shields.io/github/stars/d3d0n/omp-statify?style=flat-square)](https://github.com/d3d0n/omp-statify/stargazers) [![Issues](https://img.shields.io/github/issues/d3d0n/omp-statify?style=flat-square)](https://github.com/d3d0n/omp-statify/issues) [![Last commit](https://img.shields.io/github/last-commit/d3d0n/omp-statify?style=flat-square)](https://github.com/d3d0n/omp-statify/commits/main) [![Bun 1.4.2](https://img.shields.io/badge/Bun-1.4.2-f9f1e1?logo=bun&logoColor=black&style=flat-square)](https://bun.sh)

An [Oh-my-pi](https://github.com/can1357/oh-my-pi) extension that selects useful parts of large text results from **any OMP tool** before they enter the main model's context. Jev runs through OpenRouter by default; experimental Jeff runs as a separate local server. Statify can also shorten earlier plain-text assistant messages at OMP's pre-model `context` hook. User prompts and instruction messages are never rewritten. Original text is kept locally for exact recovery; the main model does not change.

Statify starts **off**. Jev requires its own OpenRouter key; Jeff needs no OpenRouter key. After explicit `/statify on`, both providers default to `replace`. Jeff 0.8B **omitted a required code line and produced a wrong main-model answer in a paired check**; selecting it for replacement accepts that risk. Unsupported inputs, failed requests, and non-shrinking replacements keep the original. Original text remains archived for recovery when a replacement succeeds, but recovery does not make an incorrect omission harmless. See the [paired benchmark](docs/benchmarks.md#paired-jev--local-jeff-08b-relevance-and-latency).

## Quick start

Requires [OMP](https://github.com/can1357/oh-my-pi#install) and Bun. Install the package as an OMP plugin (extension discovery is automatic):

```sh
omp plugin install github:d3d0n/omp-statify
omp
```

Statify starts **off**. In OMP, run `/statify key add` to get the installed package's terminal command for entering your OpenRouter key without echo, then `/statify on`. Run `/statify status` to check. Once published to npm, `omp plugin install omp-statify` will install the same package. The optional statusline is off by default; key storage uses `0600` permissions and is **not encrypted**. Enable Jev only for data you may send to OpenRouter. [Full setup and profile-aware management](docs/setup.md).

### Experimental local Jeff (Apple Silicon)

Install [Homebrew mise](https://mise.jdx.dev/getting-started.html) if needed (`brew install mise`); do **not** install uv or Python through Homebrew. In the installed plugin's OMP session, run `/statify jeff setup`. It prints absolute commands to trust that plugin's `mise.toml`, install pinned uv, download Jeff and its model, then serve Jeff. Inspect the plugin before running the trust command. No Statify checkout or global Jeff installation is needed.

Run the printed `jeff:serve` command in a **separate, persistent terminal**; Statify never starts Jeff for you. In another terminal, wait for `curl -sS http://127.0.0.1:8765/health` to report `"status":"ready"`. Then in OMP:

```text
/statify provider jeff
/statify on
/statify status
```

Jeff accepts only a loopback HTTP endpoint (default `http://127.0.0.1:8765`; change via `/statify jeff-url <url>`). It requires no OpenRouter key; if you set `JEFF_API_KEY` when starting the server, run `statify jeff-key add` for the **same active OMP profile**, or use `/statify jeff-key add` to display the installed terminal command. Never paste secrets into OMP chat. With `/statify provider jeff` and `/statify on`, Jeff now **replaces by default**, without `--statify-mode=replace`. An explicit `--statify-mode=shadow` still classifies without omitting for diagnostics. The current omission threshold lost a required code line in a public benchmark; recovery and heuristic secret bypass do not guarantee safe filtering. See [setup and cleanup](docs/setup.md), [paired results](docs/benchmarks.md#paired-jev--local-jeff-08b-relevance-and-latency), and [Jeff risks](docs/jeff.md).

## Measured results

| Public workload, GPT-6-Sol | Baseline total | Statify total **including Jev** | Quality check |
| --- | ---: | ---: | --- |
| 20 RepoQA function lookups (controlled replay) | $0.189794 | $0.148549 | 19/20 correct in both arms |
| One real pytest bug repair with a failing test | $0.099682 | $0.069380 | Regression and full `testing/test_mark.py` passed in both arms |

The replay places captured tool output in a user message; **it is not a real agent tool call**. The pytest trial used an explicit starting-file hint, and the agents took different numbers of turns and cache reads. Neither result proves that Statify alone caused the cost difference or that it preserves accuracy on arbitrary repairs. Cheaper models can lose money to Jev calls. See the [methods, exact costs, and limitations](docs/benchmarks.md).

## Documentation

- [Install, configure, disable, and remove the key](docs/setup.md)
- [Filtering, recovery, privacy, and limits](docs/architecture.md)
- [Benchmark methodology and provider-reported costs](docs/benchmarks.md)
- [Jeff research and quality risks](docs/jeff.md)
- [Local Jeff inference on macOS](docs/local-inference.md)

## TODO

- [ ] Extend the paired Jev/Jeff benchmark to held-out repair tasks, human-reviewed false omissions, realistic parallel latency and recovery during real agent work; the observed 0.8B false omission prevents a quality-equivalence claim.
- [ ] Test whether an agent actually uses archive recovery when a needed code span was omitted during a repair.
- [ ] Measure multi-repository bug fixes and add a model-aware cost gate for inexpensive main models.
