import { Notice, Plugin, requestUrl } from 'obsidian';
import { clearRendered, registerDesmosRenderers, rerenderAll } from './renderer';
import { registerSelfTest } from './selftest';
import { DEMO_API_KEY, DEFAULT_SETTINGS, DesmosLiveSettingTab } from './settings';
import type { DesmosLiveSettings } from './types';

// The official Desmos embed API. Unlike the desmos.com site bundle, this one is
// built to be framed: it has no window.top/postMessage guard, no site-shell
// auto-boot, and it inlines its own CSS and fonts (so there is no companion
// stylesheet and nothing 404s).
const apiUrl = (key: string): string =>
	`https://www.desmos.com/api/v1.11/calculator.js?apiKey=${encodeURIComponent(key)}`;

export default class DesmosLivePlugin extends Plugin {
	settings!: DesmosLiveSettings;
	calculatorJsPath?: string;
	private cacheDir?: string;

	async onload(): Promise<void> {
		const dir = this.manifest.dir;
		if (!dir) {
			new Notice('Desmos Live: could not determine the plugin folder.', 0);
			return;
		}

		// Always derived from the current plugin folder, never persisted — a saved
		// path goes stale the moment the folder is renamed.
		this.calculatorJsPath = `${dir}/calculator.js`;
		// Beside the bundle, which is gitignored and regenerated per device, so
		// rendered images are never synced around as a second copy of a figure.
		this.cacheDir = `${dir}/cache`;

		const saved = ((await this.loadData()) ?? {}) as Partial<DesmosLiveSettings>;
		this.settings = { ...DEFAULT_SETTINGS, ...saved };
		await this.ensureBundle();
		this.addSettingTab(new DesmosLiveSettingTab(this.app, this));
		registerDesmosRenderers(this);
		registerSelfTest(this);

		// invertedColors is fixed when the calculator is constructed, so a theme
		// change means rebuilding the frames rather than restyling them.
		this.registerEvent(this.app.workspace.on('css-change', () => rerenderAll(this)));
	}

	onunload(): void {
		clearRendered();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		rerenderAll(this);
	}

	/**
	 * Download the Desmos bundle if it is missing, or if the key it was fetched
	 * with is not the key configured now. The second case is the one that bites:
	 * the bundle is cached per device and a changed key would otherwise keep
	 * serving the old download indefinitely, so the key that fetched it is
	 * recorded alongside it.
	 */
	async ensureBundle(): Promise<void> {
		if (!this.calculatorJsPath) return;
		const adapter = this.app.vault.adapter;
		const key = this.settings.apiKey.trim() || DEMO_API_KEY;

		const present = await adapter.exists(this.calculatorJsPath);
		if (present && this.settings.bundleKey === key) return;

		try {
			const response = await requestUrl({ url: apiUrl(key) });
			await adapter.write(this.calculatorJsPath, response.text);
			this.settings.bundleKey = key;
			await this.saveData(this.settings);
		} catch (e) {
			new Notice(
				`Desmos Live: could not download the Desmos API (${(e as Error).message}). ` +
					'Check the API key and your connection, then reload the plugin.',
				0,
			);
		}
	}

	async readCache(key: string): Promise<string | undefined> {
		if (!this.cacheDir) return undefined;
		const path = `${this.cacheDir}/${key}.svg`;
		try {
			if (await this.app.vault.adapter.exists(path)) {
				return await this.app.vault.adapter.read(path);
			}
		} catch {
			// A cache miss and an unreadable cache are the same thing to the caller:
			// render it again.
		}
		return undefined;
	}

	async writeCache(key: string, svg: string): Promise<void> {
		if (!this.cacheDir) return;
		try {
			if (!(await this.app.vault.adapter.exists(this.cacheDir))) {
				await this.app.vault.adapter.mkdir(this.cacheDir);
			}
			await this.app.vault.adapter.write(`${this.cacheDir}/${key}.svg`, svg);
		} catch {
			// Caching is an optimisation; failing to write one costs a re-render
			// and nothing else.
		}
	}
}
