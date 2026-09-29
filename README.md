# omp-statify

[![Stars](https://img.shields.io/github/stars/d3d0n/omp-statify?style=flat-square)](https://github.com/d3d0n/omp-statify/stargazers) [![Issues](https://img.shields.io/github/issues/d3d0n/omp-statify?style=flat-square)](https://github.com/d3d0n/omp-statify/issues) [![Last commit](https://img.shields.io/github/last-commit/d3d0n/omp-statify?style=flat-square)](https://github.com/d3d0n/omp-statify/commits/main) [![Bun 1.4.2](https://img.shields.io/badge/Bun-1.4.2-f9f1e1?logo=bun&logoColor=black&style=flat-square)](https://bun.sh)

An [Oh-my-pi](https://github.com/can1357/oh-my-pi) extension that uses [Jev](https://docs.typesafe.ai/introduction) to select useful parts of large text results from **any OMP tool** before they enter the main model's context. It can also shorten earlier plain-text assistant messages at OMP's pre-model `context` hook. User prompts and instruction messages are never rewritten. Original text is kept locally for exact recovery; the main model does not change.

Statify starts **off**. Enabling it with its own OpenRouter key selects `replace`; low-confidence chunks stay visible. Network errors, unsupported results, and replacements that do not reduce the local token estimate leave the original result intact. This is a cost experiment, not a guarantee of cheaper or more accurate coding.

## Quick start

Requires [OMP](https://github.com/can1357/oh-my-pi#install) and Bun. Install the package as an OMP plugin (extension discovery is automatic):

```sh
omp plugin install github:d3d0n/omp-statify
omp
```

Statify starts **off**. In OMP, run `/statify key add` to get the installed package's terminal command for entering your OpenRouter key without echo, then `/statify on`. Run `/statify status` to check. Once published to npm, `omp plugin install omp-statify` will install the same package. The optional statusline is off by default; key storage uses `0600` permissions and is **not encrypted**. Enable Statify only for data you may send to OpenRouter. [Full setup and profile-aware management](docs/setup.md).

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
- [Jeff research: an experimental local alternative to Jev (not supported yet)](docs/jeff.md)
- [Local inference on macOS with Homebrew](docs/local-inference.md)

## TODO

- [ ] Add [Jeff](https://github.com/firelex/jeff) as an alternative to Jev, then compare both on the same public tasks for quality, latency, total cost, and privacy.
- [ ] Test whether an agent actually uses archive recovery when a needed code span was omitted during a repair.
- [ ] Measure multi-repository bug fixes and add a model-aware cost gate for inexpensive main models.
