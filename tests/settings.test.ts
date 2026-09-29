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
	readKey,
	readSettings,
	removeKey,
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
	expect(await readSettings(dir)).toEqual({
		enabled: false,
		statusline: false,
	});
	await saveSettings({ enabled: true, statusline: true }, dir);
	await saveKey("sk-or-v1-private-example", dir);
	expect(await readSettings(dir)).toEqual({ enabled: true, statusline: true });
	expect(await readKey(dir)).toBe("sk-or-v1-private-example");
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
	expect(await readSettings(dir)).toEqual({ enabled: false, statusline: true });
	expect(await readKey(dir)).toBeUndefined();
});
