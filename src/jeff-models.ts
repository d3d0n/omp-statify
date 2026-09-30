import { type ChildProcess, spawn } from "node:child_process";
import {
	chmodSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	writeSync,
} from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

export type JeffModel = {
	id: string;
	label: string;
	short: string;
	repo: string;
	revision: string;
	bytes: number;
	note: string;
};

export const DEFAULT_JEFF_MODEL = "jeff-0.8b";
export const JEFF_MODELS: readonly JeffModel[] = [
	{
		id: "jeff-0.8b",
		label: "Jeff 0.8B v1.0",
		short: "0.8B",
		repo: "mstrasser/Jeff-Qwen3.5-0.8B",
		revision: "d66458d54426fcf52046b896261df8909bbc8b05",
		bytes: 1726558964,
		note: "Default · tested with Statify",
	},
	{
		id: "jeff-0.8b-v1.1",
		label: "Jeff 0.8B v1.1",
		short: "0.8B v1.1",
		repo: "mstrasser/Jeff-Qwen3.5-0.8B",
		revision: "8e6694a5a96394dddbf3802a1b9ca4065e254409",
		bytes: 1726558966,
		note: "Better calibrated · not yet tested with Statify",
	},
	{
		id: "jeff-2b-v1.1",
		label: "Jeff 2B v1.1",
		short: "2B",
		repo: "mstrasser/Jeff-Qwen3.5-2B",
		revision: "6b0ee356755b7d02e1731b807382bc5403d88dbf",
		bytes: 4447608683,
		note: "More accurate on benchmarks · about 2× slower, 2.6× memory",
	},
];

export function findJeffModel(id: string): JeffModel | undefined {
	return JEFF_MODELS.find((model) => model.id === id);
}

export function jeffDir(env: NodeJS.ProcessEnv = process.env): string {
	return env.JEFF_DIR || join(homedir(), ".local/share/omp-statify/jeff");
}

export function jeffModelPath(id: string, env?: NodeJS.ProcessEnv): string {
	if (!findJeffModel(id)) throw new Error(`Unknown Jeff model: ${id}`);
	return join(jeffDir(env), "checkpoints", id);
}

export function jeffModelInstalled(
	id: string,
	env?: NodeJS.ProcessEnv,
): boolean {
	const path = jeffModelPath(id, env);
	return [
		"config.json",
		"decision_config.json",
		"model.safetensors",
		"readout.safetensors",
	].every((file) => existsSync(join(path, file)));
}

export async function jeffModelDiskBytes(
	id: string,
	env?: NodeJS.ProcessEnv,
): Promise<number> {
	async function size(path: string): Promise<number> {
		try {
			const info = await lstat(path);
			if (info.isFile()) return info.size;
			if (!info.isDirectory()) return 0;
			let bytes = 0;
			for (const name of await readdir(path))
				bytes += await size(join(path, name));
			return bytes;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
			throw error;
		}
	}
	return size(jeffModelPath(id, env));
}

export type JeffDownload = {
	id: string;
	done: Promise<void>;
	progress(): Promise<number>;
	cancel(): void;
};

function safeOutput(text: string): string {
	return stripVTControlCharacters(text)
		.replace(/[^\P{Cc}\n\t]/gu, "")
		.replace(/hf_[a-zA-Z0-9]{20,}/g, "[redacted]");
}

export function downloadJeffModel(
	id: string,
	options: {
		log: string;
		env?: NodeJS.ProcessEnv;
		command?: string[];
	},
): JeffDownload {
	const model = findJeffModel(id);
	if (!model) throw new Error(`Unknown Jeff model: ${id}`);
	const command = options.command ?? [
		"mise",
		"-C",
		fileURLToPath(new URL("../", import.meta.url)),
		"run",
		"jeff:model",
	];
	if (!command[0]) throw new Error("Jeff download command must not be empty");
	const env = {
		...process.env,
		...options.env,
		JEFF_MODEL_REPO: model.repo,
		JEFF_MODEL_REVISION: model.revision,
		JEFF_MODEL_DIR: id,
		HF_HUB_DISABLE_PROGRESS_BARS: "1",
	};
	mkdirSync(dirname(options.log), { recursive: true, mode: 0o700 });
	const log = openSync(options.log, "a", 0o600);
	try {
		chmodSync(options.log, 0o600);
		writeSync(
			log,
			`== Download ${model.label} ${new Date().toISOString()} ==\n`,
		);
	} catch (error) {
		closeSync(log);
		throw error;
	}
	let child: ChildProcess;
	try {
		child = spawn(command[0], command.slice(1), {
			env,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		try {
			writeSync(log, `error ${safeOutput(String(error))}\n`);
		} finally {
			closeSync(log);
		}
		return {
			id,
			done: Promise.reject(
				new Error(
					`Could not start Jeff download: ${String(error)}. Log: ${options.log}`,
				),
			),
			progress: async () =>
				Math.min(1, (await jeffModelDiskBytes(id, env)) / model.bytes),
			cancel() {},
		};
	}
	let cancelled = false;
	let settled = false;
	let cancellation: Promise<void> | undefined;
	let spawnError: Error | undefined;
	let logError: Error | undefined;
	const append = (text: string) => {
		if (logError) return;
		try {
			writeSync(log, safeOutput(text));
		} catch (error) {
			logError = error instanceof Error ? error : new Error(String(error));
		}
	};
	// Buffer each stream through newline boundaries so split tokens and escapes stay redacted.
	for (const stream of [child.stdout, child.stderr]) {
		if (!stream) continue;
		const decoder = new StringDecoder("utf8");
		let pending = "";
		stream.on("data", (data: Buffer) => {
			pending += decoder.write(data);
			const end = pending.lastIndexOf("\n");
			if (end >= 0) {
				append(pending.slice(0, end + 1));
				pending = pending.slice(end + 1);
			}
		});
		stream.on("end", () => append(pending + decoder.end()));
	}
	child.once("error", (error) => {
		spawnError = error;
	});
	const { promise: done, resolve, reject } = Promise.withResolvers<void>();
	child.once("close", async (code) => {
		if (cancellation) await cancellation;
		append(
			`\n${cancelled ? "cancelled" : spawnError ? `error ${spawnError.message}` : `exit ${code}`}\n`,
		);
		closeSync(log);
		settled = true;
		if (cancelled) reject(new Error("Download cancelled"));
		else if (spawnError)
			reject(
				new Error(
					`Could not start Jeff download: ${spawnError.message}. Log: ${options.log}`,
				),
			);
		else if (logError)
			reject(
				new Error(
					`Could not write Jeff download log: ${logError.message}. Log: ${options.log}`,
				),
			);
		else if (code !== 0 || !jeffModelInstalled(id, env))
			reject(new Error(`Download failed (exit ${code}). Log: ${options.log}`));
		else resolve();
	});
	return {
		id,
		done,
		progress: async () =>
			Math.min(1, (await jeffModelDiskBytes(id, env)) / model.bytes),
		cancel() {
			if (settled || cancelled) return;
			cancelled = true;
			const pid = child.pid;
			if (pid === undefined) return;
			const signal = (value: NodeJS.Signals | 0): boolean => {
				try {
					process.kill(-pid, value);
					return true;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
					throw error;
				}
			};
			signal("SIGTERM");
			const { promise, resolve: terminated } = Promise.withResolvers<void>();
			cancellation = promise;
			const deadline = Date.now() + 3000;
			const timer = setInterval(() => {
				if (signal(0) && Date.now() < deadline) return;
				signal("SIGKILL");
				clearInterval(timer);
				terminated();
			}, 25);
		},
	};
}

export async function deleteJeffModel(
	id: string,
	env?: NodeJS.ProcessEnv,
): Promise<void> {
	await rm(jeffModelPath(id, env), { recursive: true, force: true });
}
