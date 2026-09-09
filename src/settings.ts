import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type DesmosLivePlugin from './main';
import type { DesmosLiveSettings, PanelMode } from './types';

export const DEFAULT_HEIGHT = 400;

/**
 * Desmos's public demo key, which is what upstream shipped and what the plugin
 * falls back to. It is not a secret: an API key of this kind is served inside
 * the page of every site that uses one.
 */
export const DEMO_API_KEY = 'dcb31709b452b1cf9dc26972add0fda6';

export const DEFAULT_SETTINGS: DesmosLiveSettings = {
	defaultHeight: DEFAULT_HEIGHT,
	followTheme: true,
	defaultMode: 'interactive',
	apiKey: '',
	bundleKey: '',
	showBranding: true,
};

const MODE_LABELS: Record<PanelMode, string> = {
	figure: 'Figure, never interactive',
	interactive: 'Interactive, static until clicked',
	live: 'Live, runs immediately',
};

export class DesmosLiveSettingTab extends PluginSettingTab {
	plugin: DesmosLivePlugin;

	constructor(app: App, plugin: DesmosLivePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Counting reads the folder, so the row is built first and filled in after. */
	private showCount(setting: Setting): void {
		void this.plugin.cacheCount().then(n => {
			setting.setDesc(
				`${n} rendered ${n === 1 ? 'image' : 'images'} held in the plugin folder. ` +
					'They are regenerated on demand, so clearing them costs a redraw and ' +
					'nothing else. Worth doing after a change the cache key does not cover.',
			);
		});
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const cache = new Setting(containerEl)
			.setName('Cached graph images')
			.setDesc('Counting...')
			.addButton(button =>
				button.setButtonText('Clear').onClick(async () => {
					const n = await this.plugin.clearCache();
					new Notice(`Desmos Live: cleared ${n} cached ${n === 1 ? 'image' : 'images'}.`);
					this.showCount(cache);
				}),
			);
		this.showCount(cache);

		new Setting(containerEl)
			.setName('Desmos API key')
			.setDesc(
				'Leave empty to use Desmos\'s public demo key. Changing this re-downloads ' +
					'the Desmos bundle, since it is cached per device and was fetched with ' +
					'the previous key.',
			)
			.addText(text =>
				text
					.setPlaceholder(DEMO_API_KEY)
					.setValue(this.plugin.settings.apiKey)
					.onChange(async value => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
						await this.plugin.ensureBundle();
					}),
			);

		new Setting(containerEl)
			.setName('Show attribution mark')
			.setDesc(
				'The "powered by Desmos" mark in the corner of every graph. Turning it ' +
					'off uses an option Desmos ships but does not document, so check your ' +
					'API licence covers it before doing so.',
			)
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.showBranding).onChange(async value => {
					this.plugin.settings.showBranding = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Default height (px)')
			.setDesc('Height of each graph embed. A block can override this with its own "height" option.')
			.addText(text =>
				text
					.setPlaceholder(String(DEFAULT_HEIGHT))
					.setValue(String(this.plugin.settings.defaultHeight))
					.onChange(async value => {
						const n = parseInt(value, 10);
						if (Number.isFinite(n) && n > 0) {
							this.plugin.settings.defaultHeight = n;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName('Default mode')
			.setDesc(
				'How a block renders when it does not name a mode. Interactive draws a ' +
					'cached image and boots a calculator only when the reader clicks, so a ' +
					'note full of panels costs one running calculator at most.',
			)
			.addDropdown(drop => {
				for (const [value, label] of Object.entries(MODE_LABELS)) drop.addOption(value, label);
				drop.setValue(this.plugin.settings.defaultMode).onChange(async value => {
					this.plugin.settings.defaultMode = value as PanelMode;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Follow Obsidian theme')
			.setDesc(
				'Take the graph background, axis and gridline colours from the active ' +
					'theme. Retune them with the --desmos-live-background, ' +
					'--desmos-live-text and --desmos-live-gridline CSS variables, or ' +
					'override per block with Desmos\'s own backgroundColor and textColor.',
			)
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.followTheme).onChange(async value => {
					this.plugin.settings.followTheme = value;
					await this.plugin.saveSettings();
				}),
			);
	}
}
