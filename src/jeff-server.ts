import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
	chmod,
	type FileHandle,
	mkdir,
	open,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";
import { DEFAULT_JEFF_MODEL, jeffDir, jeffModelInstalled } from "./jeff-models";
import { statifyDir } from "./settings";

export type JeffServerRecord = {
	pid: number;
	url: string;
	startedAt: string;
	model?: string;
};
export type JeffServerState =
	| { status: "stopped" }
	| { status: "running"; record: JeffServerRecord }
	| { status: "exited"; record: JeffServerRecord };

export type JeffServerInfo = {
	url: string;
	port: number;
	status: "ready" | "loading";
	model?: string;
	authentication: boolean;
	pid?: number;
	command?: string;
	managed: boolean;
};

const exec = promisify(execFile);

export function jeffServerPaths(dir = statifyDir()): {
	record: string;
	log: string;
	setupLog: string;
	leases: string;
} {
	return {
		record: join(dir, "statify-jeff-server.json"),
		log: join(dir, "statify-jeff-server.log"),
		setupLog: join(dir, "statify-jeff-setup.log"),
		leases: join(dir, "statify-jeff-leases"),
	};
}

export function jeffInstalled(
	env: NodeJS.ProcessEnv = process.env,
	model = DEFAULT_JEFF_MODEL,
): boolean {
	return (
		existsSync(join(jeffDir(env), ".venv")) && jeffModelInstalled(model, env)
	);
}

function hasCode(error: unknown, code: string): boolean {
	return (error as NodeJS.ErrnoException).code === code;
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (hasCode(error, "ESRCH")) return false;
		if (hasCode(error, "EPERM")) return true;
		throw error;
	}
}

async function startedAt(pid: number): Promise<string> {
	try {
		return (
			await exec("ps", ["-o", "lstart=", "-p", String(pid)])
		).stdout.trim();
	} catch {
		return "";
	}
}

async function owned(record: JeffServerRecord): Promise<boolean> {
	return (
		alive(record.pid) &&
		record.startedAt !== "" &&
		(await startedAt(record.pid)) === record.startedAt
	);
}

async function privateDirectory(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await chmod(dir, 0o700);
}

export async function jeffServerState(
	dir = statifyDir(),
): Promise<JeffServerState> {
	const path = jeffServerPaths(dir).record;
	let text: string;
	try {
		text = await readFile(path, "utf8");
		await chmod(path, 0o600);
	} catch (error) {
		if (hasCode(error, "ENOENT")) return { status: "stopped" };
		throw error;
	}
	const value: unknown = JSON.parse(text);
	if (!value || typeof value !== "object")
		throw new Error("Invalid managed Jeff server record");
	const record = value as JeffServerRecord;
	if (
		!Number.isSafeInteger(record.pid) ||
		record.pid <= 0 ||
		typeof record.url !== "string" ||
		typeof record.startedAt !== "string"
	) {
		throw new Error("Invalid managed Jeff server record");
	}
	return { status: (await owned(record)) ? "running" : "exited", record };
}

async function signal(
	record: JeffServerRecord,
	sig: NodeJS.Signals,
): Promise<void> {
	if (!(await owned(record))) return;
	try {
		process.kill(-record.pid, sig);
	} catch (error) {
		if (!hasCode(error, "ESRCH")) throw error;
	}
}

export async function startJeffServer(options: {
	url: string;
	model?: string;
	dir?: string;
	command?: string[];
	env?: Record<string, string | undefined>;
}): Promise<JeffServerState> {
	const dir = options.dir ?? statifyDir();
	const model = options.model ?? DEFAULT_JEFF_MODEL;
	const state = await jeffServerState(dir);
	if (state.status === "running") return state;
	const paths = jeffServerPaths(dir);
	if (state.status === "exited") await rm(paths.record, { force: true });
	const command = options.command ?? [
		"mise",
		"-C",
		fileURLToPath(new URL("../", import.meta.url)),
		"run",
		"jeff:serve",
	];
	if (!command[0]) throw new Error("Jeff server command must not be empty");
	const url = new URL(options.url);
	const port = url.port || (url.protocol === "https:" ? "443" : "80");
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await writeFile(paths.log, "", { mode: 0o600 });
	const log = await open(paths.log, "a", 0o600);
	let child: ChildProcess;
	try {
		await log.chmod(0o600);
		child = spawn(command[0], command.slice(1), {
			detached: true,
			stdio: ["ignore", log.fd, log.fd],
			env: {
				...process.env,
				...options.env,
				JEFF_PORT: port,
				JEFF_MODEL_DIR: model,
			},
		});
		await new Promise<void>((resolve, reject) => {
			child.once("spawn", resolve);
			child.once("error", (error) =>
				reject(
					new Error(`Could not start Jeff server: ${error.message}`, {
						cause: error,
					}),
				),
			);
		});
	} finally {
		await log.close();
	}
	const pid = child.pid;
	if (pid === undefined) {
		throw new Error("Could not start Jeff server: no process id");
	}
	child.unref();
	const record: JeffServerRecord = {
		pid,
		url: options.url,
		startedAt: await startedAt(pid),
		model,
	};
	// ponytail: record/lease races are best-effort across processes; use a profile lock if strict coordination becomes necessary.
	try {
		await writeFile(paths.record, `${JSON.stringify(record)}\n`, {
			flag: "wx",
			mode: 0o600,
		});
		await chmod(paths.record, 0o600);
	} catch (error) {
		await signal(record, "SIGTERM");
		if (hasCode(error, "EEXIST")) return jeffServerState(dir);
		throw error;
	}
	return { status: "running", record };
}

export async function stopJeffServer(
	options: { dir?: string; timeoutMs?: number } = {},
): Promise<boolean> {
	const dir = options.dir ?? statifyDir();
	const state = await jeffServerState(dir);
	if (state.status === "stopped") return false;
	if (state.status === "running") {
		await signal(state.record, "SIGTERM");
		const deadline = Date.now() + (options.timeoutMs ?? 5000);
		while ((await owned(state.record)) && Date.now() < deadline) {
			await new Promise<void>((resolve) => setTimeout(resolve, 100));
		}
		await signal(state.record, "SIGKILL");
	}
	await rm(jeffServerPaths(dir).record, { force: true });
	return state.status === "running";
}

export async function jeffLogTail(
	options: { dir?: string; file?: "server" | "setup"; lines?: number } = {},
): Promise<string> {
	const paths = jeffServerPaths(options.dir);
	const path = options.file === "setup" ? paths.setupLog : paths.log;
	let text: string;
	try {
		text = await readFile(path, "utf8");
		await chmod(path, 0o600);
	} catch (error) {
		if (hasCode(error, "ENOENT")) return "";
		throw error;
	}
	const lines = Math.max(0, Math.trunc(options.lines ?? 40));
	return lines === 0
		? ""
		: stripVTControlCharacters(text)
				.replace(/\r?\n$/, "")
				.split("\n")
				.slice(-lines)
				.join("\n");
}

async function loopbackListeners(): Promise<
	Map<number, { pid?: number; command?: string }>
> {
	const listeners = new Map<number, { pid?: number; command?: string }>();
	let stdout: string;
	try {
		({ stdout } = await exec("lsof", [
			"-nP",
			"-iTCP@127.0.0.1",
			"-sTCP:LISTEN",
			"-Fpcn",
		]));
	} catch {
		return listeners;
	}
	let owner: { pid?: number; command?: string } = {};
	for (const line of stdout.split("\n")) {
		if (line.startsWith("p")) owner = { pid: Number(line.slice(1)) };
		else if (line.startsWith("c")) owner.command = line.slice(1);
		else if (line.startsWith("n")) {
			const match = /^n127\.0\.0\.1:(\d+)$/.exec(line);
			if (match) listeners.set(Number(match[1]), { ...owner });
		}
	}
	return listeners;
}

async function bindLoopback(port: number): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", resolve);
	});
	const address = server.address();
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	if (!address || typeof address === "string")
		throw new Error("Expected a loopback TCP port");
	return address.port;
}

export async function freePort(): Promise<number> {
	return bindLoopback(0);
}

export async function portOwner(
	port: number,
): Promise<{ pid?: number; command?: string } | undefined> {
	try {
		await bindLoopback(port);
		return undefined;
	} catch {
		return (await loopbackListeners()).get(port) ?? {};
	}
}

export async function listJeffServers(
	options: { dir?: string; urls?: string[] } = {},
): Promise<JeffServerInfo[]> {
	const [listeners, state] = await Promise.all([
		loopbackListeners(),
		jeffServerState(options.dir),
	]);
	const ports = new Set(listeners.keys());
	for (const value of options.urls ?? []) {
		try {
			const url = new URL(value);
			ports.add(Number(url.port || (url.protocol === "https:" ? 443 : 80)));
		} catch {
			// Ignore malformed candidate URLs; only loopback ports are probed.
		}
	}
	const servers = await Promise.all(
		[...ports].map(async (port): Promise<JeffServerInfo | undefined> => {
			const url = `http://127.0.0.1:${port}`;
			try {
				const response = await fetch(`${url}/health`, {
					signal: AbortSignal.timeout(700),
				});
				const health: unknown = await response.json();
				if (!health || typeof health !== "object") return undefined;
				const value = health as Record<string, unknown>;
				if (
					(value.status !== "ready" && value.status !== "loading") ||
					typeof value.model !== "string" ||
					!/jeff/i.test(value.model)
				)
					return undefined;
				return {
					url,
					port,
					status: value.status,
					model: value.model,
					authentication: value.authentication === true,
					...listeners.get(port),
					managed: state.status === "running" && state.record.url === url,
				};
			} catch {
				return undefined;
			}
		}),
	);
	return servers
		.filter((server): server is JeffServerInfo => server !== undefined)
		.sort((a, b) => a.port - b.port);
}

export async function capJeffLog(
	options: { dir?: string; maxBytes?: number; keepBytes?: number } = {},
): Promise<boolean> {
	let log: FileHandle;
	try {
		log = await open(jeffServerPaths(options.dir).log, "r+");
	} catch (error) {
		if (hasCode(error, "ENOENT")) return false;
		throw error;
	}
	try {
		const { size } = await log.stat();
		if (size <= (options.maxBytes ?? 1024 * 1024)) return false;
		const start = Math.max(0, size - (options.keepBytes ?? 256 * 1024));
		const buffer = Buffer.alloc(size - start);
		const { bytesRead } = await log.read(buffer, 0, buffer.length, start);
		let tail = buffer.subarray(0, bytesRead);
		if (start > 0) {
			const newline = tail.indexOf(10);
			tail =
				newline < 0 ? tail.subarray(tail.length) : tail.subarray(newline + 1);
		}
		const marker = Buffer.from(
			`[statify: log trimmed at ${new Date().toISOString()}]\n`,
		);
		await log.chmod(0o600);
		// ponytail: lines written during this in-place rewrite may be lost.
		await log.truncate(0);
		await log.writeFile(Buffer.concat([marker, tail]));
		return true;
	} finally {
		await log.close();
	}
}

export async function acquireJeffLease(dir = statifyDir()): Promise<void> {
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const leases = jeffServerPaths(dir).leases;
	await privateDirectory(leases);
	const path = join(leases, String(process.pid));
	await writeFile(path, "", { mode: 0o600 });
	await chmod(path, 0o600);
}

export async function releaseJeffLease(
	dir = statifyDir(),
): Promise<{ last: boolean }> {
	const leases = jeffServerPaths(dir).leases;
	await rm(join(leases, String(process.pid)), { force: true });
	let names: string[];
	try {
		names = await readdir(leases);
	} catch (error) {
		if (hasCode(error, "ENOENT")) return { last: true };
		throw error;
	}
	let last = true;
	for (const name of names) {
		const pid = Number(name);
		if (!/^\d+$/.test(name) || !Number.isSafeInteger(pid) || pid <= 0) continue;
		if (alive(pid)) last = false;
		else await rm(join(leases, name), { force: true });
	}
	return { last };
}
