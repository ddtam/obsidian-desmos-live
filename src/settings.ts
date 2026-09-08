import { App, PluginSettingTab, Setting } from 'obsidian';
import type DesmosLivePlugin from './main';
import type { DesmosLiveSettings, PanelMode } from './types';

export const DEFAULT_HEIGHT = 400;

export const DEFAULT_SETTINGS: DesmosLiveSettings = {
	defaultHeight: DEFAULT_HEIGHT,
	followTheme: true,
	defaultMode: 'interactive',
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

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

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
