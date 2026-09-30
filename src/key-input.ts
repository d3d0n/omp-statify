import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { Input, Text } from "@oh-my-pi/pi-tui";

export function promptKey(
	ctx: ExtensionContext,
	label: string,
): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>(
		(_tui, theme, _keybindings, done) => {
			let input: Input | undefined = new Input();
			input.mask = true;
			const title = new Text(label, 0, 0).setStyleFn((text) =>
				theme.fg("accent", theme.bold(text)),
			);
			const note = new Text(
				"Key stays out of chat; stored plaintext with 0600 permissions.",
				0,
				0,
			).setStyleFn((text) => theme.fg("muted", text));
			const hints = new Text("Enter save · Esc cancel", 0, 0).setStyleFn(
				(text) => theme.fg("dim", text),
			);
			function dispose(): void {
				if (!input) return;
				input.setValue("");
				input.onSubmit = undefined;
				input.onEscape = undefined;
				// Release native undo/kill/paste buffers along with the input itself.
				input = undefined;
			}
			function finish(value: string | undefined): void {
				dispose();
				done(value);
			}
			input.onSubmit = (value) => finish(value.trim() || undefined);
			input.onEscape = () => finish(undefined);
			return {
				get focused() {
					return input?.focused ?? false;
				},
				set focused(value: boolean) {
					if (input) input.focused = value;
				},
				render(width: number) {
					return input
						? [
								...title.render(width),
								...note.render(width),
								...input.render(width),
								...hints.render(width),
							]
						: [];
				},
				handleInput(data: string) {
					input?.handleInput(data);
				},
				debugState() {
					return input?.debugState() ?? {};
				},
				invalidate() {
					title.invalidate();
					note.invalidate();
					hints.invalidate();
					input?.invalidate();
				},
				dispose,
			};
		},
	);
}
