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

export type StatifySettings = {
	enabled: boolean;
	statusline: boolean;
	provider: "jev" | "jeff";
	jeffUrl: string;
};
export const DEFAULT_JEFF_URL = "http://127.0.0.1:8765";
const defaults: StatifySettings = {
	enabled: false,
	statusline: true,
	provider: "jev",
	jeffUrl: DEFAULT_JEFF_URL,
};

export function parseJeffUrl(input: string): string {
	const match = /^http:\/\/127\.0\.0\.1:(\d+)\/?$/i.exec(input);
	if (!match) throw new Error("Jeff URL must be http://127.0.0.1:<port>");
	const port = Number(match[1]);
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error("Jeff URL port must be between 1 and 65535");
	return `http://127.0.0.1:${port}`;
}

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
	return validateSettings(data, true);
}

function validateSettings(data: unknown, legacy = false): StatifySettings {
	if (!data || typeof data !== "object" || Array.isArray(data))
		throw new Error("Invalid Statify settings; disabled until repaired");
	const value = data as Record<string, unknown>;
	if (
		typeof value.enabled !== "boolean" ||
		typeof value.statusline !== "boolean" ||
		((value.provider !== undefined || !legacy) &&
			value.provider !== "jev" &&
			value.provider !== "jeff") ||
		((value.jeffUrl !== undefined || !legacy) &&
			typeof value.jeffUrl !== "string")
	)
		throw new Error("Invalid Statify settings; disabled until repaired");
	return {
		enabled: value.enabled,
		statusline: value.statusline,
		provider: (value.provider ?? "jev") as StatifySettings["provider"],
		jeffUrl: parseJeffUrl((value.jeffUrl ?? DEFAULT_JEFF_URL) as string),
	};
}

export async function saveSettings(
	settings: StatifySettings,
	dir = statifyDir(),
): Promise<void> {
	const valid = validateSettings(settings);
	await save(join(dir, "statify.json"), `${JSON.stringify(valid)}\n`, dir);
}

async function readStoredKey(
	path: string,
	label: string,
): Promise<string | undefined> {
	const info = await lstat(path).catch((error: unknown) => {
		if (missing(error)) return undefined;
		throw error;
	});
	if (!info) return undefined;
	if (!info.isFile() || (info.mode & 0o077) !== 0)
		throw new Error(
			`Statify ${label} key must be a regular file with 0600 permissions`,
		);
	return validKey(await readFile(path, "utf8"), label);
}

export async function readKey(dir = statifyDir()): Promise<string | undefined> {
	return readStoredKey(join(dir, "statify.key"), "OpenRouter");
}

function validKey(input: string, label = "OpenRouter"): string {
	const key = input.trim();
	if (!key || key.length > 4096 || /\p{Cc}/u.test(key))
		throw new Error(`Invalid ${label} key`);
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

export async function readJeffKey(
	dir = statifyDir(),
): Promise<string | undefined> {
	return readStoredKey(join(dir, "statify-jeff.key"), "Jeff");
}

export async function saveJeffKey(
	input: string,
	dir = statifyDir(),
): Promise<void> {
	await save(
		join(dir, "statify-jeff.key"),
		`${validKey(input, "Jeff")}\n`,
		dir,
	);
}

export async function removeJeffKey(dir = statifyDir()): Promise<void> {
	try {
		await unlink(join(dir, "statify-jeff.key"));
	} catch (error) {
		if (!missing(error)) throw error;
	}
}
