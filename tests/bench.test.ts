import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countTokens, Encoding } from "@oh-my-pi/pi-natives";
import type { BenchmarkCase } from "../bench/cases";
import {
	benchmark,
	isPublicPinnedSource,
	prepareRun,
	reportedUsage,
	scoreAnswer,
	summarize,
} from "../bench/run";

const item: BenchmarkCase = {
	id: "case",
	task: "Locate the function returning repaired data",
	source: `https://github.com/example/public/blob/${"a".repeat(40)}/src/foo.ts`,
	goldName: "repair",
	goldPath: "src/foo.ts",
	goldText: "function repair(): number { return 42; }",
	toolOutput: `${"irrelevant log line\n".repeat(120)}function repair(): number { return 42; }\n${"irrelevant log line\n".repeat(130)}`,
};
// Three chunks regardless of the tuned default chunk size.
const chunkTokens = Math.ceil(countTokens(item.toolOutput, Encoding.Jev) / 3);
const decision =
	(scores: number[], usage?: object) =>
	async (_url: string, _init: RequestInit) =>
		new Response(
			JSON.stringify({
				answers: Object.fromEntries(
					scores.map((noul, i) => [`chunk_${i}`, { type: "noul", noul }]),
				),
				usage,
			}),
		);

test("baseline and shadow preserve visible evidence; replace can omit it and recover exact archive span", async () => {
	const dir = await mkdtemp(join(tmpdir(), "bench-test-"));
	try {
		const fetcher = decision([0.99, 0.01, 0.99], {
			input_tokens: 145,
			output_tokens: 25,
			cost: 0.0003,
		});
		const base = await prepareRun(item, "baseline", dir, fetcher, "key");
		const shadow = await prepareRun(
			item,
			"shadow",
			dir,
			fetcher,
			"key",
			chunkTokens,
		);
		const replace = await prepareRun(
			item,
			"replace",
			dir,
			fetcher,
			"key",
			chunkTokens,
		);
		expect(base.run.evidence).toBe("visible");
		expect(shadow.run.evidence).toBe("visible");
		expect(shadow.run.status).toBe("shadow");
		expect(replace.run.status).toBe("replaced");
		expect(replace.run.evidence).toBe("omitted_recoverable");
		expect(replace.run.recovered).toBe(true);
		expect(replace.display).not.toContain(item.goldText);
		expect(replace.run.jev).toEqual({
			inputTokens: 145,
			outputTokens: 25,
			costUsd: 0.0003,
		});
		expect(replace.run.jevScores).toMatchObject({
			min: 0.01,
			max: 0.99,
			uncertainChunks: 0,
			lowChunks: 1,
			highChunks: 2,
			invalidChunks: 0,
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("missing gold is not credited; bypass and HTTP failure never count as a successful replacement", async () => {
	const dir = await mkdtemp(join(tmpdir(), "bench-test-"));
	try {
		let calls = 0;
		const missing = await prepareRun(
			{ ...item, goldText: "function notInToolOutput() {}" },
			"replace",
			dir,
			decision([0.01, 0.01, 0.01, 0.01]),
			"key",
			chunkTokens,
		);
		expect(missing.run.evidence).toBe("missing_gold");
		const bypass = await prepareRun(
			{ ...item, toolOutput: "short evidence", goldText: "short evidence" },
			"replace",
			dir,
			async () => {
				calls++;
				throw Error("unreachable");
			},
			"key",
		);
		expect(bypass.run.status).toBe("bypass");
		expect(bypass.run.evidence).toBe("visible");
		expect(calls).toBe(0);
		const failed = await prepareRun(
			item,
			"replace",
			dir,
			async () => new Response("denied", { status: 429 }),
			"key",
		);
		expect(failed.run.status).toBe("api_error");
		expect(failed.run.httpStatus).toBe(429);
		expect(failed.run.evidence).toBe("visible");
		const uncertain = await prepareRun(
			item,
			"replace",
			dir,
			decision([0.01, 0.5, 0.99, 0.01]),
			"key",
			chunkTokens,
		);
		expect(uncertain.run.status).toBe("replaced");
		expect(uncertain.run.evidence).toBe("visible");
		expect(uncertain.run.displayedCharacters).toBeLessThan(
			item.toolOutput.length,
		);
		expect(uncertain.run.jevScores).toMatchObject({
			min: 0.01,
			max: 0.99,
			uncertainChunks: 1,
			lowChunks: 1,
			highChunks: 1,
			invalidChunks: 0,
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("exact answer scoring distinguishes wrong functions and malformed output; provider usage never derives from context estimates", () => {
	expect(scoreAnswer('{"name":"repair","path":"src/foo.ts"}', item)).toBe(
		"correct",
	);
	expect(
		scoreAnswer(
			'{"name":"Hierarchy::HierarchyPrivate::HierarchyPrivate","path":"src/main/cpp/hierarchy.cpp"}',
			{
				...item,
				goldName: "HierarchyPrivate",
				goldPath: "src/main/cpp/hierarchy.cpp",
			},
		),
	).toBe("correct");
	expect(
		scoreAnswer(
			'{"name":"Hierarchy::HierarchyPrivate::HierarchyPrivate","path":"src/main/cpp/other.cpp"}',
			{
				...item,
				goldName: "HierarchyPrivate",
				goldPath: "src/main/cpp/hierarchy.cpp",
			},
		),
	).toBe("incorrect");
	expect(
		scoreAnswer(
			'{"name":"Hierarchy::Wrong","path":"src/main/cpp/hierarchy.cpp"}',
			{
				...item,
				goldName: "HierarchyPrivate",
				goldPath: "src/main/cpp/hierarchy.cpp",
			},
		),
	).toBe("incorrect");
	expect(scoreAnswer('{"name":"repair","path":"src/wrong.ts"}', item)).toBe(
		"incorrect",
	);
	expect(scoreAnswer("repair in src/foo.ts", item)).toBe("unscorable");
	expect(reportedUsage({ contextUsage: { tokens: 500 } })).toBeUndefined();
	expect(
		reportedUsage({
			tokens: { input: 100, cacheRead: 23, cacheWrite: 8, output: 9 },
			cost: 0.003,
		}),
	).toEqual({
		input: 100,
		cacheRead: 23,
		cacheWrite: 8,
		output: 9,
		costUsd: 0.003,
	});
});

test("live runs reject private or unpinned source before provider calls, and flag unequal assistant call counts", async () => {
	expect(isPublicPinnedSource("https://github.com/x/y/blob/main/file.ts")).toBe(
		false,
	);
	expect(
		isPublicPinnedSource(
			`https://github.com.evil.test/x/y/blob/${"a".repeat(40)}/file.ts`,
		),
	).toBe(false);
	let invoked = 0;
	const ask = async (
		_case: BenchmarkCase,
		_display: string,
		_model: string,
	) => {
		invoked++;
		return {
			answer: '{"name":"repair","path":"src/foo.ts"}',
			usage: {
				input: 100,
				cacheRead: 0,
				cacheWrite: 0,
				output: 8,
				costUsd: 0.01,
			},
			assistantCalls: invoked === 2 ? 2 : 1,
		};
	};
	await expect(
		benchmark([{ ...item, source: "/private/file.ts" }], {
			live: true,
			model: "provider/model",
			key: "key",
			ask,
		}),
	).rejects.toThrow("pinned public");
	expect(invoked).toBe(0);
	const runs = await benchmark([item], {
		live: true,
		model: "provider/model",
		key: "key",
		ask,
		fetcher: decision([0.01, 0.01, 0.01, 0.01]),
	});
	expect(runs.map((run) => run.quality)).toEqual([
		"correct",
		"correct",
		"correct",
	]);
	expect(runs.every((run) => run.comparable === false)).toBe(true);
});

test("usage aggregation is exact and leaves incomplete provider billing unknown", () => {
	const usage = {
		input: 100,
		cacheRead: 20,
		cacheWrite: 10,
		output: 5,
		costUsd: 0.01,
	};
	const base = {
		caseId: "a",
		evidence: "visible" as const,
		recovered: false,
		originalCharacters: 4,
		displayedCharacters: 4,
		quality: "correct" as const,
		comparable: true,
	};
	const runs = [
		{ ...base, mode: "baseline" as const, status: "baseline" as const, usage },
		{ ...base, mode: "baseline" as const, status: "baseline" as const, usage },
		{
			...base,
			mode: "replace" as const,
			status: "replaced" as const,
			usage,
			jev: { inputTokens: 11, outputTokens: 2, costUsd: 0.001 },
		},
		{ ...base, mode: "replace" as const, status: "api_error" as const, usage },
	];
	const totals = summarize(runs);
	expect(totals.baseline.mainUsage).toEqual({
		input: 200,
		cacheRead: 40,
		cacheWrite: 20,
		output: 10,
		costUsd: 0.02,
	});
	expect(totals.replace.jevUsage).toBeNull();
	expect(totals.replace.combinedCostUsd).toBeNull();
	expect(totals.replace.statuses).toEqual({ replaced: 1, api_error: 1 });
});
