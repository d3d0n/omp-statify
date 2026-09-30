import { afterEach, expect, test } from "bun:test";
import {
	lstat,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_JEFF_URL,
	parseJeffUrl,
	readJeffKey,
	readKey,
	readSettings,
	removeJeffKey,
	removeKey,
	saveJeffKey,
	saveKey,
	saveSettings,
} from "../src/settings";

const directories: string[] = [];
async function temporary(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "statify-settings-"));
	directories.push(dir);
	return dir;
}
afterEach(async () => {
	for (const dir of directories.splice(0))
		await rm(dir, { recursive: true, force: true });
});

test("enable and statusline persist without touching other OMP credentials", async () => {
	const dir = await temporary();
	const other = join(dir, "agent.db");
	await writeFile(other, "existing OMP auth");
	expect((await readSettings(dir)).enabled).toBe(false);
	await saveSettings(
		{
			enabled: true,
			statusline: true,
			provider: "jev",
			jeffUrl: DEFAULT_JEFF_URL,
		},
		dir,
	);
	await saveKey("sk-or-v1-private-example", dir);
	expect(await readSettings(dir)).toEqual({
		enabled: true,
		statusline: true,
		provider: "jev",
		jeffUrl: DEFAULT_JEFF_URL,
	});
	expect((await lstat(join(dir, "statify.key"))).mode & 0o777).toBe(0o600);
	await removeKey(dir);
	expect(await readKey(dir)).toBeUndefined();
	expect(await readFile(other, "utf8")).toBe("existing OMP auth");
});

test("unsafe or malformed key files cannot be read or sent", async () => {
	const dir = await temporary();
	await expect(
		saveKey("sk-or-v1-first\nsk-or-v1-second", dir),
	).rejects.toThrow();
	await writeFile(join(dir, "statify.key"), "sk-or-v1-test", { mode: 0o644 });
	await expect(readKey(dir)).rejects.toThrow("0600");
	await rm(join(dir, "statify.key"));
	await symlink(join(dir, "agent.db"), join(dir, "statify.key"));
	await expect(readKey(dir)).rejects.toThrow("0600");
});

test("CLI accepts a piped key without printing it, then removes it and disables Statify", async () => {
	const dir = await temporary();
	const key = "sk-or-v1-temporary-test-value";
	async function cli(...args: string[]) {
		const proc = Bun.spawn(["bun", "src/manage.ts", ...args], {
			cwd: join(import.meta.dir, ".."),
			env: { ...process.env, PI_CODING_AGENT_DIR: dir },
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		if (args[0] === "key" && args[1] === "add") proc.stdin.write(`${key}\n`);
		proc.stdin.end();
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { stdout, stderr, code };
	}
	const added = await cli("key", "add");
	expect(added.code).toBe(0);
	expect(added.stdout + added.stderr).not.toContain(key);
	expect(await readKey(dir)).toBe(key);
	expect((await cli("on")).code).toBe(0);
	expect((await cli("statusline", "on")).code).toBe(0);
	expect((await cli("status")).stdout).toContain(
		"on, key: set, statusline: on",
	);
	expect((await cli("key", "remove")).code).toBe(0);
	expect(await readSettings(dir)).toEqual({
		enabled: false,
		statusline: true,
		provider: "jev",
		jeffUrl: DEFAULT_JEFF_URL,
	});
	expect(await readKey(dir)).toBeUndefined();
});

test("legacy settings default the provider and endpoint; invalid supplied fields never reset silently", async () => {
	const dir = await temporary();
	const path = join(dir, "statify.json");
	await writeFile(path, '{"enabled":true,"statusline":false}');
	expect(await readSettings(dir)).toEqual({
		enabled: true,
		statusline: false,
		provider: "jev",
		jeffUrl: DEFAULT_JEFF_URL,
	});
	for (const invalid of [
		{ provider: "unknown" },
		{ provider: null },
		{ jeffUrl: "http://localhost:8765" },
		{ jeffUrl: null },
	]) {
		await writeFile(
			path,
			JSON.stringify({ enabled: true, statusline: false, ...invalid }),
		);
		await expect(readSettings(dir)).rejects.toThrow();
	}
	await expect(
		saveSettings(
			{
				enabled: true,
				statusline: false,
				provider: "jeff",
				jeffUrl: "http://localhost:8765",
			},
			dir,
		),
	).rejects.toThrow();
	await expect(
		saveSettings(
			{
				enabled: true,
				statusline: false,
				provider: "unknown" as "jev",
				jeffUrl: DEFAULT_JEFF_URL,
			},
			dir,
		),
	).rejects.toThrow();
	expect(JSON.parse(await readFile(path, "utf8")).jeffUrl).toBeNull();
});

test("Jeff URL accepts only explicit local HTTP ports", () => {
	expect(parseJeffUrl("http://127.0.0.1:1/")).toBe("http://127.0.0.1:1");
	expect(parseJeffUrl("http://127.0.0.1:65535")).toBe("http://127.0.0.1:65535");
	for (const url of [
		"http://127.0.0.1",
		"http://127.0.0.1:0",
		"http://127.0.0.1:65536",
		"https://127.0.0.1:8765",
		"http://localhost:8765",
		"http://127.1:8765",
		"http://127.0.0.1:8765/path",
		"http://127.0.0.1:8765?query",
		"http://127.0.0.1:8765#fragment",
		"http://user@127.0.0.1:8765",
	])
		expect(() => parseJeffUrl(url)).toThrow();
});

test("Jeff key is separate, private, and rejects unsafe files", async () => {
	const dir = await temporary();
	const path = join(dir, "statify-jeff.key");
	await saveKey("openrouter-secret", dir);
	await saveJeffKey("jeff-secret", dir);
	expect(await readJeffKey(dir)).toBe("jeff-secret");
	expect(await readKey(dir)).toBe("openrouter-secret");
	expect((await lstat(path)).mode & 0o777).toBe(0o600);
	await expect(saveJeffKey("two\nkeys", dir)).rejects.toThrow();
	await removeJeffKey(dir);
	await writeFile(path, "jeff-secret", { mode: 0o644 });
	await expect(readJeffKey(dir)).rejects.toThrow("0600");
	await rm(path);
	await symlink(join(dir, "statify.key"), path);
	await expect(readJeffKey(dir)).rejects.toThrow("0600");
	await removeJeffKey(dir);
	expect(await readKey(dir)).toBe("openrouter-secret");
});

test("CLI switches providers without sharing keys or disabling Jeff", async () => {
	const dir = await temporary();
	const secret = "jeff-secret-not-for-stdout";
	async function cli(args: string[], input?: string) {
		const proc = Bun.spawn(["bun", "src/manage.ts", ...args], {
			cwd: join(import.meta.dir, ".."),
			env: { ...process.env, PI_CODING_AGENT_DIR: dir },
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		if (input) proc.stdin.write(`${input}\n`);
		proc.stdin.end();
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { stdout, stderr, code };
	}
	expect((await cli(["provider", "jeff"])).code).toBe(0);
	expect((await cli(["jeff-url", "http://127.0.0.1:9123/"])).code).toBe(0);
	expect((await cli(["on"])).code).toBe(0);
	const unkeyed = await cli(["status"]);
	expect(unkeyed.stdout).toContain("on, key: missing");
	expect(unkeyed.stdout).toContain(
		"provider: jeff, endpoint: http://127.0.0.1:9123",
	);
	await writeFile(join(dir, "statify.key"), "unsafe-jev-key", { mode: 0o644 });
	expect((await cli(["status"])).stdout).toContain("key: missing");
	expect((await cli(["key", "remove"])).code).toBe(0);
	expect((await readSettings(dir)).enabled).toBe(true);
	const added = await cli(["jeff-key", "add"], secret);
	expect(added.code).toBe(0);
	expect(added.stdout + added.stderr).not.toContain(secret);
	expect((await cli(["status"])).stdout).not.toContain(secret);
	expect((await cli(["status"])).stdout).toContain("key: set");
	expect((await cli(["jeff-key", "remove"])).code).toBe(0);
	expect((await readSettings(dir)).enabled).toBe(true);
	expect(await readJeffKey(dir)).toBeUndefined();
	expect((await cli(["jeff-url", "https://127.0.0.1:9123"])).code).not.toBe(0);
	expect((await readSettings(dir)).jeffUrl).toBe("http://127.0.0.1:9123");
	expect((await cli(["provider", "jev"])).code).toBe(0);
	await writeFile(join(dir, "statify-jeff.key"), "unsafe-jeff-key", {
		mode: 0o644,
	});
	expect((await cli(["status"])).stdout).toContain("key: missing");
	expect((await cli(["status"])).stdout).toContain("provider: jev");
}, 20_000);
