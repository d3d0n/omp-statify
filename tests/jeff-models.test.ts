import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	deleteJeffModel,
	downloadJeffModel,
	findJeffModel,
	type JeffDownload,
	jeffModelDiskBytes,
	jeffModelInstalled,
	jeffModelPath,
} from "../src/jeff-models";

const directories: string[] = [];
const downloads: JeffDownload[] = [];
const groups: number[] = [];
const requiredFiles = [
	"config.json",
	"decision_config.json",
	"model.safetensors",
	"readout.safetensors",
];

async function temporary(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "statify-jeff-models-"));
	directories.push(dir);
	return dir;
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
	// Real subprocess/file readiness cannot be advanced with this process's fake timers.
	const deadline = Date.now() + 5000;
	while (!(await check())) {
		if (Date.now() >= deadline)
			throw new Error("Timed out waiting for fake download");
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 20);
		await promise;
	}
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw error;
	}
}

function start(id: string, dir: string, script: string): JeffDownload {
	const download = downloadJeffModel(id, {
		log: join(dir, "download.log"),
		env: { JEFF_DIR: dir },
		command: [process.execPath, script],
	});
	// Attach immediately so failed assertions cannot leave an unhandled subprocess rejection.
	void download.done.catch(() => {});
	downloads.push(download);
	return download;
}

afterEach(async () => {
	const pending = downloads.splice(0);
	for (const download of pending) download.cancel();
	await Promise.allSettled(pending.map((download) => download.done));
	for (const pid of groups.splice(0)) {
		if (alive(-pid)) process.kill(-pid, "SIGKILL");
	}
	for (const dir of directories.splice(0))
		await rm(dir, { recursive: true, force: true });
});

test("downloads gradually, reports disk progress, and appends sanitized logs", async () => {
	const dir = await temporary();
	const env = { JEFF_DIR: dir };
	const id = "jeff-0.8b-v1.1";
	const script = join(dir, "success.ts");
	const token = `hf_${"A".repeat(24)}`;
	await writeFile(join(dir, "download.log"), "previous download\n");
	await writeFile(
		script,
		`
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const dir = join(process.env.JEFF_DIR!, "checkpoints", process.env.JEFF_MODEL_DIR!);
await mkdir(dir, { recursive: true });
await writeFile(join(process.env.JEFF_DIR!, "environment.json"), JSON.stringify({
	repo: process.env.JEFF_MODEL_REPO,
	revision: process.env.JEFF_MODEL_REVISION,
	dir: process.env.JEFF_MODEL_DIR,
	progressBars: process.env.HF_HUB_DISABLE_PROGRESS_BARS,
}));
process.stdout.write("\\x1b[32mweights arriving\\x1b[0m\\x00\\n");
process.stderr.write(${JSON.stringify(token.slice(0, 10))});
await writeFile(join(dir, "config.json"), "weights");
// File gates let the test observe partial progress without guessing subprocess timing.
while (!existsSync(join(process.env.JEFF_DIR!, "continue"))) {
	await Bun.sleep(20);
}
process.stderr.write(${JSON.stringify(`${token.slice(10)}\n`)});
for (const file of ${JSON.stringify(requiredFiles.slice(1))}) {
	await writeFile(join(dir, file), "weights");
}
await mkdir(join(dir, ".cache"), { recursive: true });
await writeFile(join(dir, ".cache", "partial"), "partial weights");
while (!existsSync(join(process.env.JEFF_DIR!, "finish"))) {
	await Bun.sleep(20);
}
`,
	);
	const download = start(id, dir, script);
	let completed = false;
	void download.done.then(
		() => {
			completed = true;
		},
		() => {},
	);
	await waitUntil(async () => (await download.progress()) > 0);
	expect(completed).toBe(false);
	expect(jeffModelInstalled(id, env)).toBe(false);
	await writeFile(join(dir, "continue"), "");
	await waitUntil(
		async () =>
			(await jeffModelDiskBytes(id, env)) ===
			4 * "weights".length + "partial weights".length,
	);
	expect(await jeffModelDiskBytes(id, env)).toBe(
		4 * "weights".length + "partial weights".length,
	);
	await writeFile(join(dir, "finish"), "");
	await download.done;
	expect(jeffModelInstalled(id, env)).toBe(true);
	const model = findJeffModel(id);
	expect(
		JSON.parse(await readFile(join(dir, "environment.json"), "utf8")),
	).toEqual({
		repo: model?.repo,
		revision: model?.revision,
		dir: id,
		progressBars: "1",
	});
	const log = await readFile(join(dir, "download.log"), "utf8");
	expect(log).toStartWith("previous download\n== Download ");
	expect(log).toContain("weights arriving\n");
	expect(log).toContain("[redacted]");
	expect(log).not.toContain(token);
	expect(log).not.toContain("\x1b");
	expect(log).not.toContain("\x00");
	expect(log).toContain("exit 0");
	expect((await stat(join(dir, "download.log"))).mode & 0o777).toBe(0o600);
});

test("nonzero exit reports its code and log while preserving incomplete files", async () => {
	const dir = await temporary();
	const script = join(dir, "failure.ts");
	await writeFile(
		script,
		`
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const dir = join(process.env.JEFF_DIR!, "checkpoints", process.env.JEFF_MODEL_DIR!);
await mkdir(dir, { recursive: true });
await writeFile(join(dir, "config.json"), "partial");
process.exit(7);
`,
	);
	const download = start("jeff-0.8b", dir, script);
	await expect(download.done).rejects.toThrow(
		`Download failed (exit 7). Log: ${join(dir, "download.log")}`,
	);
	expect(jeffModelInstalled("jeff-0.8b", { JEFF_DIR: dir })).toBe(false);
	expect(
		await readFile(
			join(jeffModelPath("jeff-0.8b", { JEFF_DIR: dir }), "config.json"),
			"utf8",
		),
	).toBe("partial");
});

test("a successful command cannot report incomplete weights as installed", async () => {
	const dir = await temporary();
	const script = join(dir, "incomplete.ts");
	await writeFile(script, "process.exit(0);\n");
	await expect(start("jeff-0.8b", dir, script).done).rejects.toThrow(
		"Download failed (exit 0)",
	);
});

test("cancel terminates the whole download process group", async () => {
	const dir = await temporary();
	const grandchild = join(dir, "grandchild.ts");
	const script = join(dir, "cancel.ts");
	await writeFile(
		grandchild,
		`
import { writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.env.JEFF_DIR!, "grandchild-ready"), "ready");
setInterval(() => {}, 1000);
`,
	);
	await writeFile(
		script,
		`
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const child = spawn(process.execPath, [${JSON.stringify(grandchild)}], { stdio: "inherit" });
process.on("SIGTERM", () => {});
child.on("exit", () => process.exit(0));
writeFileSync(join(process.env.JEFF_DIR!, "pids.json"), JSON.stringify([process.pid, child.pid]));
setInterval(() => {}, 1000);
`,
	);
	const download = start("jeff-2b-v1.1", dir, script);
	await waitUntil(
		async () =>
			existsSync(join(dir, "grandchild-ready")) &&
			existsSync(join(dir, "pids.json")),
	);
	const [parent, child] = JSON.parse(
		await readFile(join(dir, "pids.json"), "utf8"),
	) as [number, number];
	groups.push(parent);
	expect(alive(parent)).toBe(true);
	expect(alive(child)).toBe(true);
	download.cancel();
	await expect(download.done).rejects.toThrow("Download cancelled");
	await waitUntil(
		async () => !alive(parent) && !alive(child) && !alive(-parent),
	);
	expect(await readFile(join(dir, "download.log"), "utf8")).toContain(
		"cancelled",
	);
}, 10000);

test("delete removes only the selected model and rejects traversal ids", async () => {
	const dir = await temporary();
	const env = { JEFF_DIR: dir };
	const selected = jeffModelPath("jeff-0.8b", env);
	const sibling = jeffModelPath("jeff-2b-v1.1", env);
	await mkdir(selected, { recursive: true });
	await mkdir(sibling, { recursive: true });
	await writeFile(join(selected, "weights"), "delete me");
	await writeFile(join(sibling, "weights"), "keep me");
	await deleteJeffModel("jeff-0.8b", env);
	expect(existsSync(selected)).toBe(false);
	expect(await readFile(join(sibling, "weights"), "utf8")).toBe("keep me");
	await expect(deleteJeffModel("../x", env)).rejects.toThrow(
		"Unknown Jeff model",
	);
});

test("installed requires all four checkpoint files", async () => {
	const dir = await temporary();
	const env = { JEFF_DIR: dir };
	const path = jeffModelPath("jeff-0.8b", env);
	expect(jeffModelInstalled("jeff-0.8b", env)).toBe(false);
	expect(await jeffModelDiskBytes("jeff-0.8b", env)).toBe(0);
	await mkdir(path, { recursive: true });
	for (const file of requiredFiles)
		await writeFile(join(path, file), "weights");
	expect(jeffModelInstalled("jeff-0.8b", env)).toBe(true);
	for (const file of requiredFiles) {
		await rm(join(path, file));
		expect(jeffModelInstalled("jeff-0.8b", env)).toBe(false);
		await writeFile(join(path, file), "weights");
	}
	expect(() =>
		downloadJeffModel("../x", { log: join(dir, "invalid.log"), env }),
	).toThrow("Unknown Jeff model");
});
