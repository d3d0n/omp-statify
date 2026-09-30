import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

export type BenchmarkCase = {
	id: string;
	task: string;
	toolOutput: string;
	goldName: string;
	goldPath: string;
	goldText: string;
	source: string;
};

const URL =
	"https://github.com/evalplus/repoqa_release/releases/download/2024-06-23/repoqa-2024-06-23.json.gz";
const CACHE = join(tmpdir(), "omp-statify-repoqa-2024-06-23.json");
type Needle = {
	name: string;
	path: string;
	start_line: number;
	end_line: number;
	description: string;
};
type Repo = {
	repo: string;
	commit_sha: string;
	content: Record<string, string>;
	needles: Needle[];
};
const KEYWORDS: Record<string, true> = {
	catch: true,
	if: true,
	else: true,
	for: true,
	while: true,
	do: true,
	switch: true,
	case: true,
	break: true,
	continue: true,
	return: true,
	throw: true,
	try: true,
	finally: true,
	class: true,
	struct: true,
	enum: true,
	void: true,
	int: true,
	char: true,
	bool: true,
	const: true,
	static: true,
	public: true,
	private: true,
	protected: true,
	virtual: true,
	override: true,
	namespace: true,
	using: true,
	template: true,
	typename: true,
	auto: true,
	new: true,
	delete: true,
	this: true,
	super: true,
	def: true,
	async: true,
	await: true,
	func: true,
	package: true,
	import: true,
	from: true,
	as: true,
	yield: true,
	lambda: true,
	pass: true,
	raise: true,
	with: true,
};
// The documented corpus keeps its original selection: outputs Statify could
// classify before chunk counts became dynamic (≤12 chunks of ≤1,800 characters).
const MIN = 4_000;
const MAX = 21_600;
function chunkCount(text: string): number {
	let count = 0;
	for (let start = 0; start < text.length; count++) {
		let end = Math.min(start + 1_800, text.length);
		if (end < text.length) {
			const line = text.lastIndexOf("\n", end - 1);
			if (line > start + 900) end = line + 1;
			if (
				end < text.length &&
				/[\uD800-\uDBFF]/.test(text[end - 1]) &&
				/[\uDC00-\uDFFF]/.test(text[end])
			)
				end--;
		}
		start = end;
	}
	return count;
}

function isNeedle(value: unknown): value is Needle {
	if (!value || typeof value !== "object") return false;
	const item = value as Record<string, unknown>;
	return (
		typeof item.name === "string" &&
		typeof item.path === "string" &&
		Number.isInteger(item.start_line) &&
		Number.isInteger(item.end_line) &&
		typeof item.description === "string"
	);
}

function parseDataset(value: unknown): Record<string, Repo[]> {
	if (!value || typeof value !== "object")
		throw new Error("Unexpected RepoQA dataset schema");
	const data = value as Record<string, unknown>;
	for (const [language, items] of Object.entries(data)) {
		if (!Array.isArray(items))
			throw new Error(`Unexpected RepoQA schema for ${language}`);
		for (const item of items) {
			if (!item || typeof item !== "object")
				throw new Error(`Unexpected RepoQA record for ${language}`);
			const repo = item as Record<string, unknown>;
			if (
				typeof repo.repo !== "string" ||
				typeof repo.commit_sha !== "string" ||
				!repo.content ||
				typeof repo.content !== "object" ||
				Array.isArray(repo.content) ||
				!Array.isArray(repo.needles) ||
				!repo.needles.every(isNeedle)
			) {
				throw new Error(`Unexpected RepoQA record schema for ${language}`);
			}
			for (const [path, text] of Object.entries(repo.content)) {
				if (typeof text !== "string")
					throw new Error(`Unexpected RepoQA content for ${repo.repo}:${path}`);
			}
		}
	}
	return data as Record<string, Repo[]>;
}

async function dataset(): Promise<Record<string, Repo[]>> {
	const cached = Bun.file(CACHE);
	if (!(await cached.exists())) {
		const response = await fetch(URL);
		if (!response.ok)
			throw new Error(`RepoQA download failed: ${response.status}`);
		const bytes = new Uint8Array(await response.arrayBuffer());
		await Bun.write(CACHE, gunzipSync(bytes));
	}
	return parseDataset(JSON.parse(await Bun.file(CACHE).text()));
}

export async function loadCases(
	limit: number,
	language?: string,
): Promise<BenchmarkCase[]> {
	if (!Number.isSafeInteger(limit) || limit < 0)
		throw new RangeError("limit must be a non-negative integer");
	if (!limit) return [];
	const data = await dataset();
	const cases: BenchmarkCase[] = [];
	for (const currentLanguage of Object.keys(data).sort()) {
		if (language && currentLanguage !== language) continue;
		for (const repo of data[currentLanguage]) {
			if (
				!/^[0-9a-f]{40}$/i.test(repo.commit_sha) ||
				!/^[\w.-]+\/[\w.-]+$/.test(repo.repo)
			)
				continue;
			for (const needle of repo.needles) {
				const raw = repo.content[needle.path];
				if (!raw || raw.length < MIN || !needle.description) continue;
				if (!/^[A-Za-z_$][\w$]*$/.test(needle.name) || KEYWORDS[needle.name])
					continue;
				const sourceLines = raw.split("\n");
				const targetLines = sourceLines.slice(
					needle.start_line,
					needle.end_line,
				);
				const escapedName = needle.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				const signature = new RegExp(
					currentLanguage === "go"
						? `^\\s*func\\s+(?:\\([^)]*\\)\\s*)?${escapedName}\\s*\\(`
						: currentLanguage === "python"
							? `^\\s*(?:async\\s+)?def\\s+${escapedName}\\s*\\(`
							: `^\\s*(?:(?:[\\w:*&<>]+)\\s+)*~?${escapedName}\\s*\\(`,
				);
				const offset = targetLines.findIndex((line) => signature.test(line));
				if (offset < 0) continue;
				const goldLine = targetLines[offset];
				const expectedLine = needle.start_line + offset + 1;
				const path = join(
					tmpdir(),
					`omp-statify-${repo.commit_sha}-${needle.path.replaceAll("/", "_")}`,
				);
				await Bun.write(path, raw);
				const result = await Bun.$`omp read ${path}`.quiet();
				if (result.exitCode !== 0)
					throw new Error(
						`omp read failed for ${repo.repo}:${needle.path}: ${result.stderr.toString()}`,
					);
				const toolOutput = result.stdout.toString();
				if (
					toolOutput.length < MIN ||
					toolOutput.length > MAX ||
					chunkCount(toolOutput) > 12
				)
					continue;
				const goldText = toolOutput.split("\n").find((line) => {
					const match = /^(\d+)(?:-(\d+))?:/.exec(line);
					return (
						line.includes(goldLine) &&
						match !== null &&
						Number(match[1]) <= expectedLine &&
						Number(match[2] ?? match[1]) >= expectedLine
					);
				});
				if (!goldText) continue;
				const source = `https://github.com/${repo.repo}/blob/${repo.commit_sha}/${needle.path}`;
				if (
					!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/blob\/[0-9a-f]{40}\/[\w./-]+$/i.test(
						source,
					)
				)
					continue;
				cases.push({
					id: `${currentLanguage}:${repo.repo}:${needle.path}:${needle.start_line}-${needle.end_line}`,
					task: needle.description,
					toolOutput,
					goldName: needle.name,
					goldPath: needle.path,
					goldText,
					source,
				});
				if (cases.length === limit) return cases;
			}
		}
	}
	return cases;
}
