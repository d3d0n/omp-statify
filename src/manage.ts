#!/usr/bin/env bun
import {
	readKey,
	readSettings,
	removeKey,
	saveKey,
	saveSettings,
} from "./settings";

async function hiddenKey(): Promise<string> {
	if (!process.stdin.isTTY) return Bun.stdin.text();
	process.stdout.write("OpenRouter key (hidden): ");
	process.stdin.setRawMode(true);
	process.stdin.resume();
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	let value = "";
	const finish = (error?: Error) => {
		process.stdin.off("data", onData);
		process.stdin.setRawMode(false);
		process.stdin.pause();
		process.stdout.write("\n");
		if (error) reject(error);
		else resolve(value);
	};
	const onData = (bytes: Buffer) => {
		const raw = bytes.toString("utf8");
		const text = raw.includes("\u001b")
			? raw.replaceAll("\u001b[200~", "").replaceAll("\u001b[201~", "")
			: raw;
		for (const character of text) {
			if (character === "\r" || character === "\n") return finish();
			if (character === "\x03" || character === "\x04")
				return finish(new Error("Cancelled"));
			if (character === "\x7f" || character === "\b")
				value = value.slice(0, -1);
			else if (character >= " " && character <= "~") value += character;
			if (value.length > 4096) return finish(new Error("Key too long"));
		}
	};
	process.stdin.on("data", onData);
	return promise;
}

async function main(): Promise<void> {
	const [action, argument, extra] = process.argv.slice(2);
	if (extra) throw new Error("Unexpected argument");
	if (action === "status" && !argument) {
		const settings = await readSettings();
		const key = await readKey();
		console.log(
			`Statify: ${settings.enabled ? "on" : "off"}, key: ${key ? "set" : "missing"}, statusline: ${settings.statusline ? "on" : "off"}`,
		);
		return;
	}
	if ((action === "on" || action === "off") && !argument) {
		const settings = await readSettings();
		await saveSettings({ ...settings, enabled: action === "on" });
		console.log(`Statify ${action}`);
		return;
	}
	if (action === "statusline" && (argument === "on" || argument === "off")) {
		const settings = await readSettings();
		await saveSettings({ ...settings, statusline: argument === "on" });
		console.log(`Statusline ${argument}`);
		return;
	}
	if (action === "key" && argument === "add") {
		await saveKey(await hiddenKey());
		console.log(
			"OpenRouter key saved; enable Statify separately with /statify on in OMP or statify on in a terminal",
		);
		return;
	}
	if (action === "key" && argument === "remove") {
		await removeKey();
		const settings = await readSettings();
		await saveSettings({ ...settings, enabled: false });
		console.log("Statify disabled; OpenRouter key removed");
		return;
	}
	throw new Error(
		"Usage: bun src/manage.ts on|off|status|key add|key remove|statusline on|off",
	);
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : "Statify command failed",
		);
		process.exitCode = 1;
	}
}
