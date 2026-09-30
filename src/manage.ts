#!/usr/bin/env bun
import { jeffSetupInstructions } from "./jeff-setup";
import {
	parseJeffUrl,
	readJeffKey,
	readKey,
	readSettings,
	removeJeffKey,
	removeKey,
	saveJeffKey,
	saveKey,
	saveSettings,
} from "./settings";

async function hiddenKey(label = "OpenRouter"): Promise<string> {
	if (!process.stdin.isTTY) return Bun.stdin.text();
	process.stdout.write(`${label} key (hidden): `);
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
		const key =
			settings.provider === "jeff" ? await readJeffKey() : await readKey();
		const keyStatus = key
			? "set"
			: settings.provider === "jeff"
				? "missing (optional unless Jeff requires auth)"
				: "missing";
		console.log(
			`Statify: ${settings.enabled ? "on" : "off"}, key: ${keyStatus}, statusline: ${settings.statusline ? "on" : "off"}, provider: ${settings.provider}, endpoint: ${settings.provider === "jeff" ? settings.jeffUrl : "OpenRouter"}`,
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
	if (action === "provider" && (argument === "jev" || argument === "jeff")) {
		const settings = await readSettings();
		await saveSettings({ ...settings, provider: argument });
		console.log(`Provider ${argument}`);
		return;
	}
	if (action === "jeff-url" && argument) {
		const settings = await readSettings();
		const jeffUrl = parseJeffUrl(argument);
		await saveSettings({ ...settings, jeffUrl });
		console.log(`Jeff endpoint ${jeffUrl}`);
		return;
	}
	if (action === "jeff" && argument === "setup") {
		console.log(jeffSetupInstructions());
		return;
	}
	if (action === "jeff-key" && (argument === "add" || argument === "edit")) {
		await saveJeffKey(await hiddenKey("Jeff"));
		console.log(
			"Jeff key saved; enable Statify separately with /statify on in OMP or statify on in a terminal",
		);
		return;
	}
	if (action === "jeff-key" && argument === "remove") {
		await removeJeffKey();
		console.log("Jeff key removed");
		return;
	}
	if (action === "key" && (argument === "add" || argument === "edit")) {
		await saveKey(await hiddenKey());
		console.log(
			"OpenRouter key saved; enable Statify separately with /statify on in OMP or statify on in a terminal",
		);
		return;
	}
	if (action === "key" && argument === "remove") {
		await removeKey();
		const settings = await readSettings();
		if (settings.provider === "jev")
			await saveSettings({ ...settings, enabled: false });
		console.log(
			settings.provider === "jev"
				? "Statify disabled; OpenRouter key removed"
				: "OpenRouter key removed",
		);
		return;
	}
	throw new Error(
		"Usage: bun src/manage.ts on|off|status|provider jev|jeff|jeff-url <url>|jeff-key add|edit|remove|jeff setup|key add|edit|remove|statusline on|off",
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
