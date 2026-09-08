import { Notice, Plugin, requestUrl } from 'obsidian';
import { clearRendered, registerDesmosRenderers, rerenderAll } from './renderer';
import { DEFAULT_SETTINGS, DesmosLiveSettingTab } from './settings';
import type { DesmosLiveSettings } from './types';

// The official Desmos embed API. Unlike the desmos.com site bundle, this one is
// built to be framed: it has no window.top/postMessage guard, no site-shell
// auto-boot, and it inlines its own CSS and fonts (so there is no companion
// stylesheet and nothing 404s). Key is Desmos's public demo API key, which has
// Calculator3D enabled alongside GraphingCalculator.
const DESMOS_API_URL =
	'https://www.desmos.com/api/v1.11/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6';

export default class DesmosLivePlugin extends Plugin {
	settings!: DesmosLiveSettings;
	calculatorJsPath?: string;

	async onload(): Promise<void> {
		const dir = this.manifest.dir;
		if (!dir) {
			new Notice('Desmos Live: could not determine the plugin folder.', 0);
			return;
		}

		// Always derived from the current plugin folder, never persisted — a saved
		// path goes stale the moment the folder is renamed.
		this.calculatorJsPath = `${dir}/calculator.js`;

		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.calculatorJsPath))) {
			try {
				const response = await requestUrl({ url: DESMOS_API_URL });
				await adapter.write(this.calculatorJsPath, response.text);
			} catch (e) {
				new Notice(
					`Desmos Live: could not download the Desmos API (${(e as Error).message}). ` +
						'Check your connection and reload the plugin.',
					0,
				);
			}
		}

		const saved = ((await this.loadData()) ?? {}) as Partial<DesmosLiveSettings>;
		this.settings = { ...DEFAULT_SETTINGS, ...saved };
		this.addSettingTab(new DesmosLiveSettingTab(this.app, this));
		registerDesmosRenderers(this);

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
}
