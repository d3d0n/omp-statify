import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = resolve(root, "mise.toml");
const warning =
	"Jeff is experimental and requires Apple Silicon macOS. In measured testing, Jeff 0.8B omitted required code and caused a wrong main-model answer.";
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const serveCommand = `mise -C ${quote(root)} run jeff:serve`;
const startInstructions =
	`Open a separate persistent terminal and run:\n${serveCommand}\n` +
	"Keep that terminal/server running while using Jeff. Then use Check connection in Jeff settings; installation does not prove server readiness. Filtering and the selected provider are unchanged; enable filtering explicitly only when ready.";

export function jeffSetupInstructions(): string {
	return [
		warning,
		"Requires mise (if missing: brew install mise). Python and uv are managed by the pinned plugin tasks, not Homebrew.",
		`Review ${config} before trusting it: trust permits this plugin's tasks to run and download dependencies/model. Run the following only if you approve:`,
		`mise trust ${quote(config)}`,
		`mise -C ${quote(root)} install uv`,
		`mise -C ${quote(root)} run jeff:setup`,
		startInstructions,
	].join("\n\n");
}

// Installer output stays in native UI, never in model messages or transcripts.
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
		if (
			secret &&
			secret.length >= 8 &&
			/token|password|secret|key/i.test(name)
		) {
			text = text.replaceAll(secret, "[redacted]");
		}
	}
	return text.slice(0, 6000);
}

export async function setupJeff(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<void> {
	ctx.ui.notify(warning, "warning");
	const action = await ctx.ui.select("Jeff setup (experimental)", [
		{
			label: "Install / update pinned Jeff",
			description:
				"Install pinned uv, Jeff server, Python dependencies and 0.8B model; requires explicit trust approval.",
		},
		{
			label: "Show manual setup instructions",
			description:
				"Review trust/install commands and the separate persistent-terminal server command; runs nothing.",
		},
	]);
	if (action === "Show manual setup instructions") {
		ctx.ui.notify(jeffSetupInstructions(), "info");
		return;
	}
	if (action !== "Install / update pinned Jeff") return;
	if (process.platform !== "darwin" || process.arch !== "arm64") {
		ctx.ui.notify(
			"Jeff installation is supported only on Apple Silicon macOS (darwin/arm64). Nothing was installed or trusted.",
			"error",
		);
		return;
	}
	try {
		const result = await pi.exec("mise", ["--version"], {
			cwd: root,
			timeout: 10_000,
		});
		if (result.code !== 0 || result.killed) {
			ctx.ui.notify(
				`mise --version failed (exit ${result.code}${result.killed ? ", killed/timed out" : ""}).\n${safeOutput(result.stderr || result.stdout)}\nInstall mise with: brew install mise\nThen retry Jeff setup. Nothing was installed or trusted.`,
				"error",
			);
			return;
		}
	} catch (error) {
		ctx.ui.notify(
			`Cannot run mise --version: ${safeOutput(error instanceof Error ? error.message : String(error))}\nInstall mise with: brew install mise\nThen retry Jeff setup. Nothing was installed or trusted.`,
			"error",
		);
		return;
	}
	const approved = await ctx.ui.confirm(
		"Trust plugin and install Jeff?",
		`Absolute installed plugin configuration:\n${config}\n\nApproving runs mise trust on this file, trusts/runs its plugin tasks, and downloads pinned uv, Python dependencies, the Jeff server and model. Review the file first.\n\n${warning}\n\nThe server will NOT be launched automatically. Filtering and selected provider will NOT change.`,
	);
	if (!approved) return;
	const commands = [
		["trust", config],
		["-C", root, "install", "uv"],
		["-C", root, "run", "jeff:setup"],
	];
	for (const args of commands) {
		const command = `mise ${args.map(quote).join(" ")}`;
		ctx.ui.notify(
			`Running ${command}. Installation may take several minutes.`,
			"info",
		);
		try {
			// ExecOptions.timeout is milliseconds; allow 30 minutes for model downloads.
			const result = await pi.exec("mise", args, {
				cwd: root,
				timeout: 30 * 60 * 1000,
			});
			if (result.code !== 0 || result.killed) {
				ctx.ui.notify(
					`Failed: ${command}\nExit ${result.code}${result.killed ? " (killed/timed out)" : ""}\n${safeOutput([result.stderr, result.stdout].filter(Boolean).join("\n"))}\nSetup stopped; the server was not started.`,
					"error",
				);
				return;
			}
		} catch (error) {
			ctx.ui.notify(
				`Failed: ${command}\n${safeOutput(error instanceof Error ? error.message : String(error))}\nSetup stopped; the server was not started.`,
				"error",
			);
			return;
		}
	}
	ctx.ui.notify(
		`Pinned Jeff installation completed.\n\n${warning}\n\n${startInstructions}`,
		"info",
	);
}
