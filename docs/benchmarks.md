# Benchmarks

These are small public-code experiments, not a leaderboard result or a guarantee of savings. Compare **main-model input tokens** separately from **total provider-reported cost** (main model plus Jev). Fewer visible characters or a lower local token estimate alone do not establish lower billed cost: prompt-cache reads/writes, model output, Jev calls (including `no_op`), and extra reads matter. OMP's `/context` token count is not a dollar metric.

## RepoQA: public pinned cases

[`bench/cases.ts`](../bench/cases.ts) uses the [RepoQA 2024-06-23 release](https://github.com/evalplus/repoqa_release/releases/download/2024-06-23/repoqa-2024-06-23.json.gz), public GitHub source at pinned commit SHAs, and actual `omp read` output. The selected 20 targets are 7 Go, 7 Python, and 6 C++. `goldText` is the exact **visible OMP signature/marker line**, not the complete function body; answer quality checks the function name and path, **not** the official RepoQA BLEU score. The runner rejects unpinned or non-public source. Offline runs use synthetic Jev and no main-model spending; `--live` explicitly permits external requests and requires `OPENROUTER_API_KEY` in the environment. Never put a key in command arguments or the repository.

```sh
bun bench/run.ts --limit 1
bun bench/run.ts --live --jev-only --language go --offset 1 --limit 7
bun bench/run.ts --live --jev-only --language python --limit 7
bun bench/run.ts --live --jev-only --language cpp --offset 2 --limit 6
bun bench/run.ts --live --model openai-codex/gpt-6-sol --language go --offset 1 --limit 2
bun bench/run.ts --live --model openai-codex/gpt-6-luna --language cpp --offset 2 --limit 2
```

For a full main-model replay of those same 20 targets, split each language's specified offset/limit range into runs of at most two cases (`--limit 1..2`); Jev-only allows up to 20 per command. The replay sends a captured `omp read` result inside a **user prompt** to OMP RPC with model tools disabled. It is not an actual OMP `tool_result` exchange and does not test whether an agent can safely edit code.

With the newer chunking, Jev shortened 17/20 results and left 3 intact: **170,993 → 91,252 visible characters**; the marker line remained visible in all 20. There were 108 Jev questions, and provider-reported Jev cost for the 20 `replace` calls was **$0.00338058**. Of 88 inter-chunk boundaries, 79 landed after a blank line before a top-level block, versus 25 with older chunking. The older run displayed 95,358 characters, but separate stochastic Jev runs cannot attribute that difference entirely to chunking. Character counts do not measure main-model tokens.

| Controlled one-answer replay | Baseline | Replace | Interpretation |
| --- | ---: | ---: | --- |
| Sol correct function and path | 19/20 | 19/20 | Visible-marker check only |
| Sol main-model input tokens | 92,592 | 70,279 | Not a bill |
| Sol total cost, including Jev | $0.189794 | $0.14854858 | 21.7% less observed |

The older chunking also scored 19/20 with a 20.5% cost reduction on Sol; separate runs are not a significance test. A full Luna monetary replay was **not** rerun after the chunking change; before that change its total cost **increased 14%**. A previously paid C++ case with a false `catch` label was excluded from all current quality and cost denominators.

## Actual OMP sessions: short function lookup

In four fresh single-turn A/B pairs on pinned public [`uvw/util.h`](https://github.com/skypjack/uvw/blob/ba10b27646035594fc1dd9525dede8573b71a7d7/src/uvw/util.h), OMP actually called `read`; the displayed result changed from **8,745 to 2,225 characters**. Both branches in each pair correctly named `try_read`. The repository path was supplied in the prompt, so this does not test independent path discovery. OpenRouter `usage` reported **3,128 Jev input / 94 output tokens and $0.000131376 per call**. Amounts below are USD; savings equal baseline model cost minus replace total, so negative means replace cost more.

| Model; run order | Baseline model | Replace model | Jev | Replace total | Savings |
| --- | ---: | ---: | ---: | ---: | ---: |
| Luna; baseline → replace | $0.000603 | $0.000315060 | $0.000131376 | $0.000446436 | +$0.000156564 |
| Luna; replace → baseline | $0.000372600 | $0.000452700 | $0.000131376 | $0.000584076 | −$0.000211476 |
| Sol; baseline → replace | $0.011837600 | $0.003993200 | $0.000131376 | $0.004124576 | +$0.007713024 |
| Sol; replace → baseline | $0.011837600 | $0.008847600 | $0.000131376 | $0.008978976 | +$0.002858624 |

Sol cost less in both orders; Luna only in one. Luna baseline/replace `cacheRead` was **2,560/4,096** in one order and **5,120/2,560** in the other. Cache state can reverse the cost result even for the same short task. These are function lookups, not code-fix trials or evidence of consistent savings.

After adding free `record` and a local token-size gate, another single-turn A/B on the same file again had correct answers and **8,745 → 2,225** displayed characters. In record → replace order total cost **rose $0.006931200 → $0.008887926** (replace model $0.008757600, Jev $0.000130326); in replace → record order it **fell $0.007864800 → $0.004971126** (replace model $0.004840800, Jev $0.000130326). In the first order, `record` had 2,688 cached tokens on its first request while `replace` had zero. The gate checks a **local estimate**, not billed tokens, and `record` incurs no Jev cost.

## One real repair: SWE-bench Verified

For [SWE-bench Verified `pytest-dev__pytest-10356`](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified), two separate checkouts used pytest [base commit `3c1534944cbd34e8a41bc9e76818018fadefc9a1`](https://github.com/pytest-dev/pytest/tree/3c1534944cbd34e8a41bc9e76818018fadefc9a1) with the same regression test from the case's `test_patch`. `testing/test_mark.py::test_mark_mro` failed before either repair. Both agents received the same multiple-inheritance marker task and an explicit starting-file hint (`src/_pytest/mark/structures.py:raw`) to ensure a long read; both used Sol and Python 3.11. This is **not** an unassisted official SWE-bench score.

| Branch | Main-model cost | Jev cost | Total cost | Post-repair test |
| --- | ---: | ---: | ---: | --- |
| `record` baseline | $0.099682000 | $0 (no `statify usage` records) | $0.099682000 | Passed |
| `replace` | $0.069136400 | $0.000243264 ($0.000137382 replacement + $0.000105882 `no_op`) | $0.069379664 | Passed |

Both independently passed the regression and the full `testing/test_mark.py`: **89 passed, 1 xfailed**; the test-file hash stayed unchanged. The first read changed **10,284 → 7,274 characters**; a second 5,745-character read remained unchanged but still incurred Jev cost. The replace agent obtained missing context with ordinary ranged `read`, not `xd://statify_read`. Observed total savings were **$0.030302336 (30.4%)** on this one task. The baseline made 13 model turns versus replace's 11, with `cacheRead` **184,960 versus 106,112**. The difference cannot be attributed solely to Jev, and neither one repair nor the short lookups establish general quality or cost improvement.

## Paired Jev / local Jeff 0.8B: relevance and latency

On a base Apple M4 (24 GB, macOS 27.0), 20 of the same pinned public RepoQA inputs above (Go offset 1 × 7, Python offset 0 × 7, C++ offset 2 × 6; 170,993 original characters) went through `statifyResult` with identical task, chunk questions and order per pair. Jev used OpenRouter `typesafe/jev-1.13`; a **warmed** localhost Jeff server used `jeff-qwen3.5-0.8b` (MLX). Each provider classified each case once in `shadow`; the exact response was then replayed locally through `replace` to check whether the pinned function-signature line remained visible. The replay made **no second provider call**. Provider order alternated by case; latency below covers the live `shadow` request and response consumption, not archival or the main model. The only data sent to OpenRouter was pinned public code and its public task.

| 20 matched cases; 108 questions per provider | Jev | Jeff 0.8B |
| --- | ---: | ---: |
| Gold signature line visible after `replace` replay | **20/20** | **19/20** |
| `replaced` / `no_op` | 16 / 4 | 14 / 6 |
| Original → displayed characters | 170,993 → 105,920 | 170,993 → 106,974 |
| Median / p90 live decision latency | 0.512 / 0.615 s | **2.409 / 2.992 s** |
| Classifier provider-reported charge | $0.003376044 | Not reported; local resources not free |

The missing Jeff signature was [`processExecution` in public `fzf/src/terminal.go`](https://github.com/junegunn/fzf/blob/e352b6887849cb6c3c8ae1d98ed357f94273e90a/src/terminal.go): Jeff scored its chunk **0.0907148** (below the current `≤0.15` omission cutoff), while Jev scored it about **0.59** and kept it. Jeff's replay displayed **2,418 of 10,827** characters; the exact omitted signature was recoverable from its archive, but not visible to the main model. A separate public 11-question input took **6.628 s Jeff vs 0.990 s Jev**. Three additional labelled lookups in pinned Statify code preserved their required lines with both providers; Jeff shortened **none** of those three results, Jev shortened one. None of these checks used the 2B checkpoint.

For the `fzf` miss, a single controlled GPT-6-Sol replay placed the same captured read output in a **user prompt with model tools disabled**. Baseline and Jev `replace` answered `processExecution` correctly; Jeff `replace` answered **`isExecuteAction`**, an incorrect function from the same file. Jeff's shorter context cost the main model **$0.011616** versus **$0.011446** baseline because its wrong response used 569 output tokens versus 17; Jev `replace` cost **$0.008616392** including the Jev call. This is one model replay, **not** a live agent code-repair trial or proof of general accuracy. The model could not invoke `xd://statify_read` in this replay; a real agent might recover missing text if it notices the omission.

**Decision boundary:** These observations demonstrate at least one consequential false omission for Jeff 0.8B at the Jev-oriented `≤0.15` cutoff and slower warmed local decisions in this sample. They do **not** establish a false-omission rate, validate another threshold/model, measure local energy/memory cost, or prove downstream quality across coding tasks. Jeff `replace` remains experimental: selecting Jeff and enabling Statify explicitly accepts that risk. Explicit `--statify-mode=shadow` remains available for future diagnostics, but it is **not** Jeff's default.
