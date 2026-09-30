# omp-statify

[![Stars](https://img.shields.io/github/stars/d3d0n/omp-statify?style=flat-square)](https://github.com/d3d0n/omp-statify/stargazers) [![Issues](https://img.shields.io/github/issues/d3d0n/omp-statify?style=flat-square)](https://github.com/d3d0n/omp-statify/issues) [![Last commit](https://img.shields.io/github/last-commit/d3d0n/omp-statify?style=flat-square)](https://github.com/d3d0n/omp-statify/commits/main) [![Bun 1.4.2](https://img.shields.io/badge/Bun-1.4.2-f9f1e1?logo=bun&logoColor=black&style=flat-square)](https://bun.sh)

An [Oh-my-pi](https://github.com/can1357/oh-my-pi) plugin that shortens large tool outputs before the assistant reads them. It leaves your prompts and chosen AI model unchanged. When output is shortened, the full version is saved locally for recovery.

Statify is **off until you enable it**. Choose how to process output:

- **Jev (cloud):** uses OpenRouter and needs a separate API key. Only enable it for data you are allowed to send there.
- **Jeff (local, experimental):** runs on your Apple Silicon Mac without an OpenRouter key.

## Quick start

Requires [OMP](https://github.com/can1357/oh-my-pi#install) and Bun:

```sh
omp plugin install github:d3d0n/omp-statify
omp
```

1. Open `/statify` in OMP and choose **Jev · cloud**.
2. Get an [OpenRouter API key](https://openrouter.ai/settings/keys), choose **Add API key**, and paste it into the masked dialog.
3. Choose **Enable Jev** and confirm.

Use the same menu to edit or remove your key. Saving a key does not turn Statify on. Your key is stored locally, **not encrypted**; never paste it into ordinary chat.

The statusline at the bottom shows which provider is on, whether Jeff's server is ready, when a request is being processed, and how many tokens the last request used and saved. **paused** means Jeff isn't ready yet, so output passes through unchanged. Show or hide it from `/statify`. [Full setup and controls](docs/setup.md).

### Local Jeff (experimental)

Requires an Apple Silicon Mac.

1. Open `/statify` → **Jeff · local (experimental)** → **Install / update Jeff**.
2. Review the trust prompt before approving downloads. If mise is missing, install it with `brew install mise` and retry.
3. Choose **Enable Jeff (experimental)** and confirm. Statify starts the local server in the background—no separate terminal needed—and stops it when Jeff is disabled or the last OMP window closes.

In the Jeff menu you can start, stop, or restart the server, view its logs, and switch to another server or port — for example, when the usual port is already taken.

If the server keeps failing, choose **Reinstall Jeff**: after asking, it downloads Jeff again (about 2 GB). [Jeff setup and troubleshooting](docs/setup.md#jeff-experimental-local-provider).

If setup or the server fails, ask OMP “why did Statify setup fail?” — the bundled **statify-troubleshooting** skill reads the logs.

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
