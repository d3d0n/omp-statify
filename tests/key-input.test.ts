import { expect, test } from "bun:test";
import type {
	ExtensionContext,
	ExtensionUiComponent,
} from "@oh-my-pi/pi-coding-agent";
import type { TUI } from "@oh-my-pi/pi-tui";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui";
import { promptKey } from "../src/key-input";

function openPrompt() {
	ensureThemeSync();
	let component!: ExtensionUiComponent;
	const ctx = new Proxy({} as ExtensionContext, {
		get(_target, property) {
			if (property !== "ui")
				throw new Error(`Unexpected context use: ${String(property)}`);
			return {
				custom: (factory: Parameters<ExtensionContext["ui"]["custom"]>[0]) => {
					const { promise, resolve } = Promise.withResolvers<unknown>();
					component = factory(
						{} as TUI,
						theme,
						{} as Parameters<typeof factory>[2],
						resolve,
					) as ExtensionUiComponent;
					return promise;
				},
			};
		},
	});
	const result = promptKey(ctx, "Provider key");
	return { component, result };
}

const secret = "synthetic-private-key-12345";

test("pasted keys remain masked in rendering and debug state while native editing saves the key", async () => {
	const { component, result } = openPrompt();
	component.handleInput?.(`\x1b[200~${secret}X\x1b[201~`);
	component.handleInput?.("\x7f");
	for (const width of [20, 100]) {
		const rendered = component.render(width).join("\n");
		expect(rendered).toContain("•");
		for (const fragment of [secret, "synthetic", "private", "12345"])
			expect(rendered).not.toContain(fragment);
	}
	expect(component.render(100).join("\n")).toContain("•".repeat(secret.length));
	expect(JSON.stringify(component.debugState?.())).not.toContain(secret);
	component.handleInput?.("\r");
	expect(await result).toBe(secret);
	expect(component.render(100)).toEqual([]);
	component.handleInput?.("\x1f");
	expect(JSON.stringify(component.debugState?.())).not.toContain(secret);
});

test("cancel discards a secret and empty submission cannot erase an existing key", async () => {
	const cancelled = openPrompt();
	cancelled.component.handleInput?.(`\x1b[200~${secret}\x1b[201~`);
	cancelled.component.handleInput?.("\x1b");
	expect(await cancelled.result).toBeUndefined();
	cancelled.component.handleInput?.("\x1f");
	cancelled.component.handleInput?.("\r");
	expect(cancelled.component.render(100)).toEqual([]);
	expect(JSON.stringify(cancelled.component.debugState?.())).not.toContain(
		secret,
	);

	const empty = openPrompt();
	empty.component.handleInput?.("\r");
	expect(await empty.result).toBeUndefined();
});
