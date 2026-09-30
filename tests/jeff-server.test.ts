import { afterEach, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acquireJeffLease,
	capJeffLog,
	freePort,
	jeffInstalled,
	jeffLogTail,
	jeffServerPaths,
	jeffServerState,
	listJeffServers,
	portOwner,
	releaseJeffLease,
	startJeffServer,
	stopJeffServer,
} from "../src/jeff-server";

const directories: string[] = [];

async function temporary(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "statify-jeff-server-"));
	directories.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of directories.splice(0)) {
		try {
			await stopJeffServer({ dir, timeoutMs: 1000 });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}
});

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
	// Poll real subprocess/socket readiness: fake timers cannot advance the operating system.
	const deadline = Date.now() + 4000;
	while (!(await check())) {
		if (Date.now() >= deadline)
			throw new Error("Timed out waiting for server state");
		await new Promise<void>((resolve) => setTimeout(resolve, 20));
	}
}

async function unrelatedProcess(): Promise<ChildProcess> {
	const child = spawn("sleep", ["30"], { stdio: "ignore" });
	await once(child, "spawn");
	return child;
}

async function killChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, "exit");
	child.kill("SIGKILL");
	await exited;
}

test("a managed server starts once, serves health, and stops its listener", async () => {
	const dir = await temporary();
	const port = await freePort();
	const url = `http://127.0.0.1:${port}`;
	const script = join(dir, "fake-server.ts");
	await writeFile(
		script,
		`Bun.serve({
		hostname: "127.0.0.1",
		port: Number(process.env.JEFF_PORT),
		fetch(request) {
			return new URL(request.url).pathname === "/health"
				? Response.json({ status: "ready", authentication: false, model: process.env.JEFF_MODEL_DIR })
				: new Response("not found", { status: 404 });
		},
	});\n`,
	);
	const paths = jeffServerPaths(dir);
	await writeFile(paths.log, "previous run", { mode: 0o644 });
	await chmod(dir, 0o755);
	const options = {
		dir,
		url,
		model: "jeff-2b-v1.1",
		command: [process.execPath, script],
	};
	const started = await startJeffServer(options);
	expect(started.status).toBe("running");
	if (started.status !== "running") throw new Error("Server did not start");
	expect(started.record.model).toBe("jeff-2b-v1.1");
	await waitUntil(async () => {
		try {
			const response = await fetch(`${url}/health`);
			return response.ok;
		} catch {
			return false;
		}
	});
	expect(await (await fetch(`${url}/health`)).json()).toEqual({
		status: "ready",
		authentication: false,
		model: "jeff-2b-v1.1",
	});
	expect(await jeffServerState(dir)).toEqual(started);
	expect(JSON.parse(await readFile(paths.record, "utf8"))).toEqual(
		started.record,
	);
	expect((await lstat(paths.record)).mode & 0o777).toBe(0o600);
	expect((await lstat(paths.log)).mode & 0o777).toBe(0o600);
	expect((await lstat(dir)).mode & 0o777).toBe(0o755);
	expect(await readFile(paths.log, "utf8")).not.toContain("previous run");
	// A broken replacement command proves that a running server does not spawn again.
	const again = await startJeffServer({
		...options,
		command: [join(dir, "missing-binary")],
	});
	expect(again).toEqual(started);
	expect(await stopJeffServer({ dir, timeoutMs: 1000 })).toBe(true);
	await expect(fetch(`${url}/health`)).rejects.toThrow();
	await expect(lstat(paths.record)).rejects.toMatchObject({ code: "ENOENT" });
	expect(await jeffServerState(dir)).toEqual({ status: "stopped" });
}, 10000);

test("Jeff installation requires the venv and all selected model files", async () => {
	const dir = await temporary();
	const env = { JEFF_DIR: dir };
	const model = "jeff-2b-v1.1";
	const modelPath = join(dir, "checkpoints", model);
	await mkdir(modelPath, { recursive: true });
	const files = [
		"config.json",
		"decision_config.json",
		"model.safetensors",
		"readout.safetensors",
	];
	for (const file of files) await writeFile(join(modelPath, file), "");
	expect(jeffInstalled(env, model)).toBe(false);
	await mkdir(join(dir, ".venv"));
	expect(jeffInstalled(env, model)).toBe(true);
	expect(jeffInstalled(env, "jeff-0.8b")).toBe(false);
	expect(jeffInstalled(env)).toBe(false);
	for (const file of files) {
		await rm(join(modelPath, file));
		expect(jeffInstalled(env, model)).toBe(false);
		await writeFile(join(modelPath, file), "");
	}
});

test("a failed server retains its stderr for diagnosis and removes the stale record on stop", async () => {
	const dir = await temporary();
	await startJeffServer({
		dir,
		url: `http://127.0.0.1:${await freePort()}`,
		command: [
			process.execPath,
			"-e",
			'console.error("\\x1b[31mfake server failed\\x1b[0m"); process.exit(23);',
		],
	});
	await waitUntil(async () => (await jeffServerState(dir)).status === "exited");
	expect(await jeffLogTail({ dir })).toBe("fake server failed");
	expect(await stopJeffServer({ dir })).toBe(false);
	await expect(lstat(jeffServerPaths(dir).record)).rejects.toMatchObject({
		code: "ENOENT",
	});
	expect(await jeffServerState(dir)).toEqual({ status: "stopped" });
}, 10000);

test("a live foreign pid with a mismatched start time is never signalled", async () => {
	const dir = await temporary();
	const child = await unrelatedProcess();
	try {
		const pid = child.pid;
		if (pid === undefined) throw new Error("spawn failed");
		const record = {
			pid,
			url: "http://127.0.0.1:8765",
			startedAt: "not this process's start time",
		};
		await writeFile(jeffServerPaths(dir).record, JSON.stringify(record), {
			mode: 0o600,
		});
		expect(await jeffServerState(dir)).toEqual({ status: "exited", record });
		expect(await stopJeffServer({ dir })).toBe(false);
		expect(process.kill(pid, 0)).toBe(true);
		expect(child.exitCode).toBeNull();
		await expect(lstat(jeffServerPaths(dir).record)).rejects.toMatchObject({
			code: "ENOENT",
		});
	} finally {
		await killChild(child);
	}
});

test("leases keep a shared server in use until the last live process releases", async () => {
	const dir = await temporary();
	const child = await unrelatedProcess();
	try {
		const pid = child.pid;
		if (pid === undefined) throw new Error("spawn failed");
		await acquireJeffLease(dir);
		const leases = jeffServerPaths(dir).leases;
		const other = join(leases, String(pid));
		await writeFile(other, "", { mode: 0o600 });
		expect((await lstat(join(leases, String(process.pid)))).mode & 0o777).toBe(
			0o600,
		);
		expect((await lstat(leases)).mode & 0o777).toBe(0o700);
		expect(await releaseJeffLease(dir)).toEqual({ last: false });
		await expect(
			lstat(join(leases, String(process.pid))),
		).rejects.toMatchObject({ code: "ENOENT" });
		await killChild(child);
		await acquireJeffLease(dir);
		expect(await releaseJeffLease(dir)).toEqual({ last: true });
		await expect(lstat(other)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await killChild(child);
	}
});

test("a failed spawn rejects without publishing a managed server record", async () => {
	const dir = await temporary();
	await expect(
		startJeffServer({
			dir,
			url: `http://127.0.0.1:${await freePort()}`,
			command: [join(dir, "does-not-exist")],
		}),
	).rejects.toThrow();
	await expect(lstat(jeffServerPaths(dir).record)).rejects.toMatchObject({
		code: "ENOENT",
	});
	expect(await jeffServerState(dir)).toEqual({ status: "stopped" });
});

test("freePort returns an available loopback listener port", async () => {
	const port = await freePort();
	const server = createServer();
	try {
		server.listen(port, "127.0.0.1");
		await once(server, "listening");
		expect(server.address()).toMatchObject({ address: "127.0.0.1", port });
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});

test("portOwner distinguishes a free port from a loopback listener", async () => {
	const port = await freePort();
	expect(await portOwner(port)).toBeUndefined();
	const server = createServer();
	try {
		server.listen(port, "127.0.0.1");
		await once(server, "listening");
		const owner = await portOwner(port);
		expect(owner).toBeDefined();
		if (owner?.pid !== undefined) expect(owner.pid).toBe(process.pid);
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
	expect(await portOwner(port)).toBeUndefined();
});

test("listJeffServers discovers external Jeff and excludes other HTTP servers", async () => {
	const dir = await temporary();
	const jeff = Bun.serve({
		hostname: "127.0.0.1",
		port: await freePort(),
		fetch: () =>
			Response.json({
				status: "ready",
				model: "jeff-test",
				authentication: false,
			}),
	});
	const other = Bun.serve({
		hostname: "127.0.0.1",
		port: await freePort(),
		fetch: () =>
			Response.json({
				status: "ready",
				model: "some-other-model",
				authentication: false,
			}),
	});
	try {
		const url = `http://127.0.0.1:${jeff.port}`;
		const servers = await listJeffServers({
			dir,
			urls: [url, `http://127.0.0.1:${other.port}`, url],
		});
		expect(servers.find((server) => server.port === jeff.port)).toMatchObject({
			url,
			port: jeff.port,
			status: "ready",
			model: "jeff-test",
			authentication: false,
			managed: false,
		});
		expect(servers.some((server) => server.port === other.port)).toBe(false);
		expect(servers.map((server) => server.port)).toEqual(
			[...new Set(servers.map((server) => server.port))].sort((a, b) => a - b),
		);
	} finally {
		jeff.stop(true);
		other.stop(true);
	}
});

test("capJeffLog keeps recent full lines and a running child appends after trimming", async () => {
	// The child uses real intervals; fake timers cannot advance another process.
	const dir = await temporary();
	const script = join(dir, "log-writer.ts");
	const paused = join(dir, "paused");
	const resume = join(dir, "resume");
	await writeFile(
		script,
		`import { existsSync, writeFileSync } from "node:fs";
let line = 0;
setInterval(() => {
	if (line >= 12 && !existsSync(${JSON.stringify(resume)})) return;
	line++;
	console.log("line-" + String(line).padStart(4, "0") + " " + "x".repeat(48));
	if (line === 12) writeFileSync(${JSON.stringify(paused)}, "");
}, 50);\n`,
	);
	await startJeffServer({
		dir,
		url: `http://127.0.0.1:${await freePort()}`,
		command: [process.execPath, script],
	});
	const path = jeffServerPaths(dir).log;
	await waitUntil(async () => {
		try {
			await lstat(paused);
			return (await readFile(path, "utf8")).includes("line-0012");
		} catch {
			return false;
		}
	});
	const newest = `line-0012 ${"x".repeat(48)}\n`;
	const maxBytes = 256;
	expect(await capJeffLog({ dir, maxBytes, keepBytes: 128 })).toBe(true);
	const trimmed = await readFile(path, "utf8");
	expect(trimmed).toMatch(
		/^\[statify: log trimmed at \d{4}-\d{2}-\d{2}T[^\]]+\]\nline-\d{4} /,
	);
	expect(trimmed.endsWith(newest)).toBe(true);
	expect(Buffer.byteLength(trimmed)).toBeLessThan(maxBytes + newest.length);
	expect(trimmed).not.toContain("line-0001");
	expect(await capJeffLog({ dir, maxBytes, keepBytes: 128 })).toBe(false);
	await writeFile(resume, "");
	await waitUntil(async () =>
		(await readFile(path, "utf8")).includes("line-0015"),
	);
	await stopJeffServer({ dir, timeoutMs: 1000 });
	const continued = await readFile(path, "utf8");
	expect(continued.startsWith(trimmed)).toBe(true);
	expect(continued).not.toContain("\0");
	expect(continued).toContain(`line-0013 ${"x".repeat(48)}\n`);
	expect(continued).toMatch(/line-\d{4} x{48}\n$/);
	expect(
		Number(continued.trimEnd().split("\n").at(-1)?.slice(5, 9)),
	).toBeGreaterThanOrEqual(15);
	expect((await lstat(path)).mode & 0o777).toBe(0o600);
}, 10000);
