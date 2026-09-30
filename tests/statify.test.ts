import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zod from "@oh-my-pi/omptype/zod";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { countTokens } from "@oh-my-pi/pi-natives";
import statify, {
	readArchive,
	statifyAssistantContext,
	statifyMode,
	statifyReceipt,
	statifyResult,
} from "../src/index";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(
		dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});
async function archive() {
	const dir = await mkdtemp(join(tmpdir(), "statify-test-"));
	dirs.push(dir);
	return dir;
}
const tool = (
	text: string,
	toolName = "read",
	isError = false,
	path = "src/main.ts",
) => ({
	toolName,
	input: { path },
	isError,
	content: [{ type: "text" as const, text }],
});
const longText = `${"irrelevant log line\n".repeat(110)}IMPORTANT: invoke repair() before restart\n${"irrelevant log line\n".repeat(110)}`;

function decisions(
	scores: number[],
	inspect?: (body: {
		model: string;
		state: unknown;
		questions: Record<
			string,
			{ instructions: string; criteria: Record<string, string> }
		>;
	}) => Promise<void>,
) {
	return async (url: string, init: RequestInit) => {
		expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
		const body = JSON.parse(init.body as string);
		await inspect?.(body);
		return new Response(
			JSON.stringify({
				answers: Object.fromEntries(
					scores.map((noul, i) => [`chunk_${i}`, { type: "noul", noul }]),
				),
			}),
			{ status: 200 },
		);
	};
}

test("archives before request, selects verbatim fragments, and restores omitted output after restart", async () => {
	const dir = await archive();
	const store = join(dir, "session.jsonl.statify");
	let calls = 0;
	let requests = 0;
	let tokens: { original: number; replacement: number } | undefined;
	const fetcher = decisions([0.01, 0.99, 0.01], async (body) => {
		calls++;
		expect(body.model).toBe("typesafe/jev-1.13");
		expect(body.state).toEqual({ task: "Find repair order" });
		expect(Object.keys(body.questions)).toEqual([
			"chunk_0",
			"chunk_1",
			"chunk_2",
		]);
		expect(body.questions.chunk_1.instructions).toContain(
			"IMPORTANT: invoke repair()",
		);
		expect(body.questions.chunk_1.criteria.true).toContain("exact data");
		// The full extension-visible text must already be durable before the outbound request.
		const [file] = await readdir(store);
		if (!file) throw new Error("Archive missing before classification");
		expect(
			await readArchive(
				store,
				file.replace(/\.txt$/, ""),
				`1-${longText.length}`,
			),
		).toBe(longText);
	});
	const result = await statifyResult(tool(longText), {
		archive: store,
		task: "Find repair order",
		key: "test-key",
		consent: true,
		mode: "replace",
		fetcher,
		onRequest: () => {
			requests++;
		},
		observe: (observation) => {
			tokens = observation.tokens;
		},
	});
	expect(calls).toBe(1);
	if (!result) throw new Error("Expected a selected result");
	expect(requests).toBe(1);
	expect(tokens?.original).toBe(countTokens(longText));
	expect(tokens?.replacement).toBe(countTokens(result.content[0].text));
	expect(tokens?.original).toBeGreaterThan(tokens?.replacement ?? Infinity);
	const receipt = result.content[0].text;
	expect(receipt).toContain("IMPORTANT: invoke repair()");
	expect(receipt).toContain("Shown: ");
	expect(receipt).toContain("Omitted: ");
	expect(receipt).not.toContain(longText);
	const id = /statify archive ([\da-f-]+)/.exec(receipt)?.[1];
	if (!id) throw new Error("Receipt missing archive ID");
	expect(receipt).toContain(
		createHash("sha256").update(longText).digest("hex"),
	);
	// A fresh reader, independent of the handler's process state, can retrieve the exact text.
	const parts: string[] = [];
	for (let start = 1; start <= longText.length; start += 8_000) {
		parts.push(
			await readArchive(
				store,
				id,
				`${start}-${Math.min(longText.length, start + 7_999)}`,
			),
		);
	}
	expect(parts.join("")).toBe(longText);
	await expect(
		readArchive(join(dir, "other-session.jsonl.statify"), id, "1-5"),
	).rejects.toThrow();
	await expect(readArchive(store, "../other-session", "1-5")).rejects.toThrow(
		"Invalid archive ID",
	);
	await expect(readArchive(store, id, "1-8001")).rejects.toThrow(
		"at most 8000",
	);
	await expect(
		readArchive(store, id, `1-${longText.length + 1}`),
	).rejects.toThrow("exceeds archive length");
});

test("irrelevant chunks are omitted without hiding an uncertain answer or OMP read provenance", async () => {
	const dir = await archive();
	const header = "[/tmp/project/src/repair.ts#AB12]\n";
	const gold = "101: export function repair(): void { restart(); }\n";
	const text = [
		header,
		Array.from({ length: 100 }, (_, i) => `${i + 1}: unrelated setup\n`).join(
			"",
		),
		gold,
		Array.from(
			{ length: 100 },
			(_, i) => `${i + 102}: relevant context\n`,
		).join(""),
		Array.from({ length: 109 }, (_, i) => `${i + 202}: unrelated tail\n`).join(
			"",
		),
		"311: LAST unrelated tail\n",
	].join("");
	const original = tool(text);
	const result = await statifyResult(original, {
		archive: dir,
		task: "Find repair order",
		key: "test-key",
		consent: true,
		mode: "replace",
		fetcher: decisions([0.15, 0.5, 0.5, 0.01]),
	});
	if (!result) throw new Error("Expected omitted chunks");
	const display = result.content[0].text;
	expect(display).toContain(header);
	expect(display).toContain(gold);
	expect(display).not.toContain("\n1: unrelated setup\n");
	expect(display).not.toContain("311: LAST unrelated tail");
	expect(display.length).toBeLessThan(text.length);
	expect(display).toContain(`Shown: 1-${header.length}, `);
	expect(original.content[0].text).toBe(text);
	const id = /statify archive ([\da-f-]+)/.exec(display)?.[1];
	if (!id) throw new Error("Receipt missing archive ID");
	const parts: string[] = [];
	for (let start = 1; start <= text.length; start += 8_000)
		parts.push(
			await readArchive(
				dir,
				id,
				`${start}-${Math.min(text.length, start + 7_999)}`,
			),
		);
	expect(parts.join("")).toBe(text);
});

test("a numbered Python declaration stays with its decorator, docstring, and body", async () => {
	const header = "[/tmp/fixture.py#ABCD]\n";
	const prefix = Array.from(
		{ length: 60 },
		(_, i) => `${i + 1}: setting_${i}=lookup(value)\n`,
	).join("");
	const block = [
		"61:",
		"62:@trace",
		"63:def target() -> str:",
		'64:    """Handle the target request."""',
		'65:    return "ok"',
		"66:",
		"",
	].join("\n");
	const tail = Array.from(
		{ length: 120 },
		(_, i) => `${i + 67}: unrelated_${i}=lookup(value)\n`,
	).join("");
	const text = header + prefix + block + tail;
	let inspected = false;
	await statifyResult(tool(text), {
		archive: await archive(),
		task: "Find target",
		key: "test-key",
		consent: true,
		mode: "shadow",
		fetcher: decisions([0.5, 0.5, 0.5, 0.5], async (body) => {
			inspected = true;
			const chunks = Object.values(body.questions).map((q) => q.instructions);
			const target = chunks.find((chunk) => chunk.includes("def target()"));
			expect(chunks).toHaveLength(4);
			expect(chunks[0]).not.toContain("@trace");
			expect(target).toContain("@trace");
			expect(target).toContain('"""Handle the target request."""');
			expect(target).toContain('return "ok"');
		}),
	});
	expect(inspected).toBe(true);
});

test("all-low chunks still have a receipt; shadow and non-shrinking results leave no archive", async () => {
	const dir = await archive();
	const text = "not task data\n".repeat(300);
	const base = {
		archive: dir,
		task: "Find repair order",
		key: "test-key",
		consent: true,
		mode: "replace" as const,
	};
	const none = await statifyResult(tool(text), {
		...base,
		fetcher: decisions([0.02, 0.02, 0.02]),
	});
	expect(none?.content[0].text).toContain(`Omitted: 1-${text.length}`);
	expect(none?.content[0].text).toContain("Shown: none");
	const shadow = join(dir, "shadow");
	expect(
		await statifyResult(tool(text), {
			...base,
			archive: shadow,
			mode: "shadow",
			fetcher: decisions([0.02, 0.99, 0.02]),
		}),
	).toBeUndefined();
	await expect(readdir(shadow)).rejects.toThrow();
	const noOp = join(dir, "no-op");
	expect(
		await statifyResult(tool("x".repeat(3600) + "z".repeat(400)), {
			...base,
			archive: noOp,
			fetcher: decisions([0.99, 0.99, 0.01]),
		}),
	).toBeUndefined();
	expect(await readdir(noOp)).toEqual([]);
});

test("a shorter receipt that costs more model tokens leaves the original output unchanged", async () => {
	const dir = await archive();
	const text = "a".repeat(10_800);
	const selected = Array.from({ length: 5 }, (_, i) => ({
		start: i * 1_800 + 1,
		end: (i + 1) * 1_800,
	}));
	const result = await statifyResult(tool(text), {
		archive: dir,
		task: "Find the relevant function",
		key: "test-key",
		consent: true,
		mode: "replace",
		fetcher: decisions([0.99, 0.99, 0.99, 0.99, 0.99, 0.01], async () => {
			const [filename] = await readdir(dir);
			if (!filename) throw new Error("Archive missing before decision");
			const receipt = statifyReceipt(
				text.length,
				selected,
				filename.slice(0, -4),
				createHash("sha256").update(text).digest("hex"),
			);
			const display = `${receipt}${selected
				.map(
					({ start, end }) =>
						`[${start}-${end}]\n${text.slice(start - 1, end)}`,
				)
				.join("\n")}`;
			expect(display.length).toBeLessThan(text.length);
			expect(countTokens(display)).toBeGreaterThan(countTokens(text));
		}),
	});
	expect(result).toBeUndefined();
	expect(await readdir(dir)).toEqual([]);
});

test("non-read tool output, including errors, is filtered and recoverable", async () => {
	const dir = await archive();
	const result = await statifyResult(tool(longText, "bash", true), {
		archive: dir,
		task: "Find repair order",
		key: "test-key",
		consent: true,
		mode: "replace",
		fetcher: decisions([0.01, 0.99, 0.01]),
	});
	if (!result) throw new Error("Expected filtered shell output");
	const output = result.content[0].text;
	expect(output).toContain("IMPORTANT: invoke repair()");
	expect(output).not.toContain("irrelevant log line\n".repeat(100));
	const id = /statify archive ([\da-f-]+)/.exec(output)?.[1];
	if (!id) throw new Error("Missing recovery ID");
	expect(await readArchive(dir, id, `1-${longText.length}`)).toBe(longText);
});

test("context filters past assistant prose without changing user or instruction messages", async () => {
	const dir = await archive();
	type Messages = Parameters<typeof statifyAssistantContext>[0];
	const messages = [
		{ role: "user", content: longText, timestamp: 1 },
		{
			role: "developer",
			content: [{ type: "text", text: longText }],
			timestamp: 2,
		},
		{
			role: "assistant",
			content: [{ type: "text", text: longText }],
			timestamp: 3,
		},
	] as Messages;
	let calls = 0;
	const options = {
		archive: dir,
		task: "Find repair order",
		key: "test-key",
		consent: true,
		mode: "replace" as const,
		fetcher: decisions([0.01, 0.99, 0.01], async () => {
			calls++;
		}),
	};
	const cache = new Map<string, Promise<string | undefined>>();
	const result = await statifyAssistantContext(messages, options, cache);
	if (result?.[2]?.role !== "assistant")
		throw new Error("Expected filtered assistant context");
	expect(result[0]).toBe(messages[0]);
	expect(result[1]).toBe(messages[1]);
	expect(result[2].content[0]).toHaveProperty(
		"text",
		expect.stringContaining("statify archive"),
	);
	expect(
		messages[2]?.role === "assistant" && messages[2].content[0],
	).toHaveProperty("text", longText);
	await statifyAssistantContext(messages, options, cache);
	expect(calls).toBe(1);
});

test("bypass keeps short, images, skill, plan, explicit full request, and suspected secrets local", async () => {
	const dir = await archive();
	let calls = 0;
	let requests = 0;
	const fetcher = async (
		_url: string,
		_init: RequestInit,
	): Promise<Response> => {
		calls++;
		throw new Error("unexpected network call");
	};
	const base = {
		archive: dir,
		task: "Find repair order",
		key: "test-key",
		consent: true,
		mode: "replace" as const,
		fetcher,
		onRequest: () => {
			requests++;
		},
	};
	const variants = [
		tool("short"),
		tool(longText, "statify_read"),
		{
			...tool(longText, "write"),
			input: {
				path: "xd://statify_read",
				content: '{"id":"archive","range":"1-2000"}',
			},
		},
		tool(longText, "read", false, "skill://ponytail"),
		tool(longText, "grep", false, "docs/plan.md"),
		tool(longText, "read", false, "local://repair-plan.md"),
		tool(`[Could not read src/thing.ts: missing]\n${longText}`),
		tool(`OPENROUTER_API_KEY=secret\n${longText}`),
		tool("x".repeat(25_000)),
		{
			...tool(longText),
			content: [{ type: "image" as const, data: "abc", mimeType: "image/png" }],
		},
	];
	for (const event of variants) {
		expect(await statifyResult(event, base)).toBeUndefined();
		expect(calls).toBe(0);
	}
	expect(
		await statifyResult(tool(longText), { ...base, task: "Show full output" }),
	).toBeUndefined();
	expect(calls).toBe(0);
	expect(
		await statifyResult(tool(longText), {
			...base,
			task: "Find repair order. PASSWORD=synthetic-placeholder",
		}),
	).toBeUndefined();
	expect(calls).toBe(0);
	expect(
		await statifyResult(tool(longText), { ...base, consent: false }),
	).toBeUndefined();
	expect(
		await statifyResult(tool(longText), { ...base, key: undefined }),
	).toBeUndefined();
	expect(calls).toBe(0);
	expect(requests).toBe(0);
	expect(await readdir(dir)).toEqual([]);
});

test("malformed answers, auth failure, network failure, and disk errors fail open", async () => {
	const dir = await archive();
	const base = {
		archive: dir,
		task: "Find repair order",
		key: "test-key",
		consent: true,
		mode: "replace" as const,
	};
	for (const replies of [
		{ chunk_0: { type: "noul", noul: 2 } },
		{ chunk_0: { type: "choice", noul: 0.9 } },
		{ chunk_0: { type: "noul", noul: 0.9 } },
		{
			chunk_0: { type: "noul", noul: 0.01 },
			chunk_1: { type: "noul", noul: null },
			chunk_2: { type: "noul", noul: 0.01 },
		},
	]) {
		const event = tool(longText);
		expect(
			await statifyResult(event, {
				...base,
				fetcher: async () => new Response(JSON.stringify({ answers: replies })),
			}),
		).toBeUndefined();
		expect(event).toEqual(tool(longText));
	}
	expect(
		await statifyResult(tool(longText), {
			...base,
			fetcher: async () => new Response("unauthorized", { status: 401 }),
		}),
	).toBeUndefined();
	expect(
		await statifyResult(tool(longText), {
			...base,
			fetcher: async () => {
				throw Error("connection reset");
			},
		}),
	).toBeUndefined();
	expect(await readdir(dir)).toEqual([]);
	expect(
		await statifyResult(tool(longText), {
			...base,
			archive: join(dir, "missing", "\0invalid"),
			fetcher: decisions([0.99, 0.99, 0.99]),
		}),
	).toBeUndefined();
});

test("Unicode boundaries reject half a surrogate, accept exact whole range", async () => {
	const dir = await archive();
	const text = `${"a".repeat(1799)}🦊${"b".repeat(2300)}`;
	const result = await statifyResult(tool(text), {
		archive: dir,
		task: "Find fox",
		key: "test-key",
		consent: true,
		mode: "replace",
		fetcher: decisions([0.01, 0.99, 0.01]),
	});
	const id =
		result && /statify archive ([\da-f-]+)/.exec(result.content[0].text)?.[1];
	if (!id) throw new Error("Receipt missing archive ID");
	expect(await readArchive(dir, id, "1800-1801")).toBe("🦊");
	await expect(readArchive(dir, id, "1800-1800")).rejects.toThrow(
		"splits a Unicode character",
	);
});

test("Jeff accepts a local unauthenticated decision and preserves the archive", async () => {
	const dir = await archive();
	let observation:
		| Parameters<NonNullable<Parameters<typeof statifyResult>[1]["observe"]>>[0]
		| undefined;
	const result = await statifyResult(tool(longText), {
		archive: dir,
		task: "Find repair order",
		provider: "jeff",
		consent: true,
		mode: "replace",
		observe: (value) => {
			observation = value;
		},
		fetcher: async (url, init) => {
			expect(url).toBe("http://127.0.0.1:8765/v1/systemone");
			expect(init.method).toBe("POST");
			expect(init.headers).toEqual({ "Content-Type": "application/json" });
			const body = JSON.parse(init.body as string);
			expect(body.model).toBe("jeff-latest");
			expect(body.state).toEqual({ task: "Find repair order" });
			expect(body.questions.chunk_1.criteria.true).toContain("exact data");
			expect((await readdir(dir)).length).toBe(1);
			return new Response(
				JSON.stringify({
					answers: Object.fromEntries(
						[0.01, 0.99, 0.01].map((noul, i) => [
							`chunk_${i}`,
							{ type: "noul", noul },
						]),
					),
					usage: { input_tokens: 120, output_tokens: 0 },
				}),
			);
		},
	});
	if (!result) throw new Error("Jeff should omit irrelevant chunks");
	expect(result.content[0].text).toContain("IMPORTANT: invoke repair()");
	expect(result.content[0].text).not.toContain(
		"irrelevant log line\n".repeat(100),
	);
	const id = /statify archive ([\da-f-]+)/.exec(result.content[0].text)?.[1];
	if (!id) throw new Error("Missing recovery ID");
	expect(await readArchive(dir, id, `1-${longText.length}`)).toBe(longText);
	expect(observation?.status).toBe("replaced");
	expect(observation?.usage).toEqual({
		inputTokens: 120,
		outputTokens: 0,
		costUsd: undefined,
	});
});

test("Jeff key is optional, invalid endpoint or answer fails open", async () => {
	const dir = await archive();
	const base = {
		archive: dir,
		task: "Find repair order",
		provider: "jeff" as const,
		consent: true,
		mode: "replace" as const,
	};
	let calls = 0;
	expect(
		await statifyResult(tool(longText), {
			...base,
			jeffUrl: "https://external.example:8765",
			fetcher: async () => {
				calls++;
				throw new Error("No external requests permitted");
			},
		}),
	).toBeUndefined();
	expect(calls).toBe(0);
	expect(await readdir(dir)).toEqual([]);
	for (const response of [
		new Response("busy", { status: 529 }),
		new Response(
			JSON.stringify({ answers: { chunk_0: { type: "noul", noul: 0.01 } } }),
		),
	]) {
		expect(
			await statifyResult(tool(longText), {
				...base,
				key: "local-secret",
				fetcher: async (url, init) => {
					expect(url).toBe("http://127.0.0.1:8765/v1/systemone");
					expect(init.headers).toEqual({
						"Content-Type": "application/json",
						Authorization: "Bearer local-secret",
					});
					return response;
				},
			}),
		).toBeUndefined();
		expect(await readdir(dir)).toEqual([]);
	}
});

test("default mode replaces for Jeff; shadow requires an explicit flag", () => {
	expect(statifyMode(undefined)).toBe("replace");
	expect(statifyMode("")).toBe("replace");
	expect(statifyMode("shadow")).toBe("shadow");
	expect(statifyMode(false)).toBeUndefined();
});

test("restored session totals survive startup and reset on switching to a new session", async () => {
	const profile = await archive();
	const previousProfile = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = profile;
	type Pi = Parameters<typeof statify>[0];
	type Ctx = ExtensionContext;
	const handlers = new Map<string, (event: never, ctx: Ctx) => unknown>();
	let command: (args: string, ctx: Ctx) => unknown = () => {};
	const appended: unknown[] = [];
	const pi = {
		zod,
		registerFlag() {},
		getFlag() {
			return "";
		},
		registerCommand(_name: string, options: { handler: typeof command }) {
			command = options.handler;
		},
		registerTool() {},
		on(name: string, handler: (event: never, ctx: Ctx) => unknown) {
			handlers.set(name, handler);
		},
		appendEntry(customType: string, data: unknown) {
			appended.push({ customType, data });
		},
		logger: { debug() {}, info() {}, warn() {}, error() {} },
	} as unknown as Pi;
	let sessionId = "resumed";
	let entries: unknown[] = [
		{
			type: "custom",
			customType: "statify-stats",
			data: {
				v: 1,
				requests: 3,
				replaced: 2,
				kept: 1,
				errors: 0,
				saved: 4200,
				used: 1200,
			},
		},
		{
			type: "custom",
			customType: "statify-stats",
			data: {
				v: 1,
				requests: 4,
				replaced: 1,
				kept: 2,
				errors: 1,
				saved: 4200,
				used: 300,
			},
		},
		{
			type: "custom",
			customType: "statify-stats",
			data: {
				v: 1,
				requests: 99,
				replaced: 99,
				kept: 0,
				errors: 0,
				saved: "bad",
				used: 0,
			},
		},
	];
	let status = "";
	let notification = "";
	const ctx = {
		sessionManager: {
			getSessionId: () => sessionId,
			getEntries: () => entries,
		},
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			setStatus: (_key: string, text?: string) => {
				status = text ?? "";
			},
			notify: (text: string) => {
				notification = text;
			},
		},
	} as unknown as Ctx;
	const emit = async (name: string) => {
		const handler = handlers.get(name);
		if (!handler) throw new Error(`Missing handler: ${name}`);
		await handler({} as never, ctx);
	};
	try {
		statify(pi);
		await emit("session_start");
		await command("status", ctx);
		expect(notification).toContain(
			"This session: 7 requests · saved 8.4k tokens · classifier used 1.5k · replaced 3, kept 3, errors 1",
		);
		expect(status).toContain(" · Σ −8.4k");
		expect(status).not.toContain(" · last ");
		sessionId = "new";
		entries = [];
		await emit("session_switch");
		await command("status", ctx);
		expect(notification).toContain(
			"This session: 0 requests · saved 0 tokens · classifier used 0 · replaced 0, kept 0, errors 0",
		);
		expect(status).not.toContain("Σ");
	} finally {
		await emit("session_shutdown");
		if (previousProfile === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousProfile;
	}
});
