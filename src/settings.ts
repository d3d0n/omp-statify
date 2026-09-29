import { randomUUID } from "node:crypto";
import {
	chmod,
	lstat,
	mkdir,
	readFile,
	rename,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";

export type StatifySettings = { enabled: boolean; statusline: boolean };
const defaults: StatifySettings = { enabled: false, statusline: false };

export function statifyDir(): string {
	return getAgentDir();
}

function missing(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function save(path: string, value: string, dir: string): Promise<void> {
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const temporary = join(dir, `.statify-${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, value, { flag: "wx", mode: 0o600 });
		await rename(temporary, path);
		await chmod(path, 0o600);
	} finally {
		await rm(temporary, { force: true });
	}
}

export async function readSettings(
	dir = statifyDir(),
): Promise<StatifySettings> {
	let text: string;
	try {
		text = await readFile(join(dir, "statify.json"), "utf8");
	} catch (error) {
		if (missing(error)) return { ...defaults };
		throw error;
	}
	const data: unknown = JSON.parse(text);
	if (
		!data ||
		typeof data !== "object" ||
		typeof (data as StatifySettings).enabled !== "boolean" ||
		typeof (data as StatifySettings).statusline !== "boolean"
	)
		throw new Error("Invalid Statify settings; disabled until repaired");
	return {
		enabled: (data as StatifySettings).enabled,
		statusline: (data as StatifySettings).statusline,
	};
}

export async function saveSettings(
	settings: StatifySettings,
	dir = statifyDir(),
): Promise<void> {
	await save(join(dir, "statify.json"), `${JSON.stringify(settings)}\n`, dir);
}

export async function readKey(dir = statifyDir()): Promise<string | undefined> {
	const path = join(dir, "statify.key");
	const info = await lstat(path).catch((error: unknown) => {
		if (missing(error)) return undefined;
		throw error;
	});
	if (!info) return undefined;
	if (!info.isFile() || (info.mode & 0o077) !== 0)
		throw new Error("Statify key must be a regular file with 0600 permissions");
	return validKey(await readFile(path, "utf8"));
}

function validKey(input: string): string {
	const key = input.trim();
	if (!key || key.length > 4096 || /\p{Cc}/u.test(key))
		throw new Error("Invalid OpenRouter key");
	return key;
}

export async function saveKey(
	input: string,
	dir = statifyDir(),
): Promise<void> {
	await save(join(dir, "statify.key"), `${validKey(input)}\n`, dir);
}

export async function removeKey(dir = statifyDir()): Promise<void> {
	try {
		await unlink(join(dir, "statify.key"));
	} catch (error) {
		if (!missing(error)) throw error;
	}
}
