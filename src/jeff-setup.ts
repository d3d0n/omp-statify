import { appendFile, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { jeffServerPaths } from "./jeff-server";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = resolve(root, "mise.toml");
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export function jeffSetupInstructions(): string {
	return [
		"Requires mise (if missing: brew install mise). Python and uv are managed by the pinned plugin tasks, not Homebrew.",
		`Review ${config} before trusting it: trust permits this plugin's tasks to run and download dependencies/model. Run the following only if you approve:`,
		`mise trust ${quote(config)}`,
		`mise -C ${quote(root)} install uv`,
		`mise -C ${quote(root)} run jeff:setup`,
		"Then enable Jeff in /statify (or run statify provider jeff && statify on). OMP starts the local server automatically and stops it when Jeff is disabled or the last OMP session exits. Filtering is experimental and requires explicit consent.",
		`Optional manual server: mise -C ${quote(root)} run jeff:serve (JEFF_PORT changes the port).`,
	].join("\n\n");
}

// Installer output stays in native UI and a sanitized local log, never model messages.
function safeOutput(value: string): string {
	let text = Bun.stripANSI(value)
		.replace(/[^\P{Cc}\n\t]/gu, "")
		.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
		.replace(/\b(Bearer\s+)[\w.+/=-]+/gi, "$1[redacted]")
		.replace(
			/\b([\w-]*(?:token|password|secret|api[_-]?key)[\w-]*\s*[=:]\s*)[^\s]+/gi,
			"$1[redacted]",
		);
	for (const [name, secret] of Object.entries(process.env)) {
		if (secret && secret.length >= 8 && /token|password|secret|key/i.test(name))
			text = text.replaceAll(secret, "[redacted]");
	}
	return text.slice(-20_000);
}

export async function setupJeff(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	options?: { reinstall?: boolean; beforeRemove?: () => Promise<void> },
): Promise<boolean> {
	const action = options?.reinstall
		? "Install / update pinned Jeff"
		: await ctx.ui.select("Jeff setup (experimental)", [
				{
					label: "Install / update pinned Jeff",
					description:
						"Install pinned uv, Jeff server, Python dependencies and 0.8B model; requires explicit trust approval.",
				},
				{
					label: "Show manual setup instructions",
					description:
						"Review trust/install commands and automatic server lifecycle; runs nothing.",
				},
			]);
	if (action === "Show manual setup instructions") {
		ctx.ui.notify(jeffSetupInstructions(), "info");
		return false;
	}
	if (action !== "Install / update pinned Jeff") return false;
	const log = jeffServerPaths().setupLog;
	const append = async (text: string) => {
		try {
			await appendFile(log, `${safeOutput(text)}\n`, { mode: 0o600 });
		} catch {
			// Logging must not break installation or the session.
		}
	};
	const failed = (text: string) => {
		pi.logger.warn("statify jeff setup failed", { log });
		ctx.ui.notify(
			`${safeOutput(text)}\nSetup log: ${log}\nAsk OMP “diagnose Statify Jeff setup” — the bundled statify-troubleshooting skill reads this log.`,
			"error",
		);
	};
	try {
		await mkdir(dirname(log), { recursive: true, mode: 0o700 });
		await writeFile(
			log,
			`${new Date().toISOString()}\nPlatform: ${process.platform}/${process.arch}\nPlugin root: ${root}\nmise.toml: ${config}\n`,
			{ mode: 0o600 },
		);
		await chmod(log, 0o600);
	} catch {
		// Log storage errors are best effort; never prevent a consented install.
	}
	const jeffDir =
		process.env.JEFF_DIR ||
		join(homedir(), ".local", "share", "omp-statify", "jeff");
	const reinstallPaths = [
		join(jeffDir, ".venv"),
		join(jeffDir, "checkpoints", "jeff-0.8b"),
	];
	if (options?.reinstall) {
		const approved = await ctx.ui.confirm(
			"Reinstall Jeff?",
			`Delete only these paths:\n${reinstallPaths.join("\n")}\n\nThen reinstall the Python environment and model (~2 GB download).`,
		);
		await append(
			approved
				? `User approved reinstall; delete only:\n${reinstallPaths.join("\n")}`
				: "User refused reinstall; nothing deleted.",
		);
		if (!approved) return false;
	}
	await append(`Preflight platform: ${process.platform}/${process.arch}`);
	if (process.platform !== "darwin" || process.arch !== "arm64") {
		const error =
			"Jeff installation is supported only on Apple Silicon macOS (darwin/arm64). Nothing was installed or trusted.";
		await append(error);
		failed(error);
		return false;
	}
	const run = async (args: string[], timeout: number): Promise<boolean> => {
		const command = `mise ${args.map(quote).join(" ")}`;
		await append(`$ ${command}`);
		try {
			const result = await pi.exec("mise", args, { cwd: root, timeout });
			await append(`stdout:\n${safeOutput(result.stdout)}`);
			await append(`stderr:\n${safeOutput(result.stderr)}`);
			await append(
				`exit ${result.code}${result.killed ? " (killed/timed out)" : ""}`,
			);
			if (result.code === 0 && !result.killed) return true;
			failed(
				`Failed: ${command}\nExit ${result.code}${result.killed ? " (killed/timed out)" : ""}\n${safeOutput(result.stderr || result.stdout)}\nSetup stopped.`,
			);
		} catch (error) {
			const message = safeOutput(
				error instanceof Error ? error.message : String(error),
			);
			await append(`error: ${message}`);
			failed(`Failed: ${command}\n${message}\nSetup stopped.`);
		}
		return false;
	};
	if (!(await run(["--version"], 10_000))) {
		ctx.ui.notify(
			"Install mise with: brew install mise. Then retry Jeff setup. Nothing was installed or trusted.",
			"info",
		);
		return false;
	}
	const approved = await ctx.ui.confirm(
		"Trust plugin and install Jeff?",
		`Absolute installed plugin configuration:\n${config}\n\nApproving runs mise trust on this file, trusts/runs its plugin tasks, and downloads pinned uv, Python dependencies, the Jeff server and model. Review the file first.\n\nFiltering and selected provider will NOT change.`,
	);
	if (!approved) {
		await append(
			"User refused trust/install approval; nothing installed or trusted.",
		);
		return false;
	}
	if (options?.reinstall) {
		try {
			await options.beforeRemove?.();
			for (const path of reinstallPaths) {
				await append(`Removing ${path}`);
				await rm(path, { recursive: true, force: true });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await append(`Reinstall removal failed: ${message}`);
			failed(`Reinstall removal failed: ${message}\nSetup stopped.`);
			return false;
		}
	}
	for (const args of [
		["trust", config],
		["-C", root, "install", "uv"],
		["-C", root, "run", "jeff:setup"],
	]) {
		ctx.ui.notify(
			`Running mise ${args.map(quote).join(" ")}. Installation may take several minutes.`,
			"info",
		);
		if (!(await run(args, 30 * 60 * 1000))) return false;
	}
	await append("Pinned Jeff installation completed.");
	ctx.ui.notify(
		"Jeff installed; enable Jeff to start the local server automatically (no separate terminal). Filtering and the selected provider are unchanged.",
		"info",
	);
	return true;
}
