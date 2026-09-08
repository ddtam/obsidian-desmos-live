import { App, PluginSettingTab, Setting } from 'obsidian';
import type DesmosLivePlugin from './main';
import type { DesmosLiveSettings } from './types';

export const DEFAULT_HEIGHT = 400;

export const DEFAULT_SETTINGS: DesmosLiveSettings = {
	defaultHeight: DEFAULT_HEIGHT,
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
			.setDesc('Height of each graph embed in pixels.')
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
	}
}
