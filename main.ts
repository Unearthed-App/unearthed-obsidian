import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
	Plugin,
	TFile,
} from "obsidian";

interface UnearthedSettings {
	unearthedApiKey: string;
	autoSync: boolean;
}

const DEFAULT_SETTINGS: UnearthedSettings = {
	unearthedApiKey: "",
	autoSync: false,
};
interface UnearthedData {
	id: string;
	title: string;
	subtitle: string;
	author: string;
	imageUrl: string;
	type: string;
	origin: string;
	userId: string;
	ignored: boolean;
	createdAt: string;
	quotes: UnearthedQuote[];
}

interface UnearthedQuote {
	id: string;
	content: string;
	note: string;
	color: string;
	location: string;
	sourceId: string;
	userId: string;
	createdAt: string;
}

export default class Unearthed extends Plugin {
	settings: UnearthedSettings;

	async onload() {
		await this.loadSettings();

		// Start sync process when Obsidian opens, if autoSync is enabled
		this.app.workspace.onLayoutReady(async () => {
			if (this.settings.autoSync) {
				new Notice("Unearthed Sync started, please wait...");
				await syncData(this);
				new Notice("Unearthed Sync complete");
			}
		});

		this.addRibbonIcon(
			"book",
			"Kindle (Unearthed) Sync",
			async (evt: MouseEvent) => {
				new Notice("Unearthed Sync started, please wait...");
				await syncData(this);
				new Notice("Unearthed Sync complete");
			}
		);

		this.addSettingTab(new UnearthedSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

async function syncData(plugin: Unearthed) {
	try {
		const { data } = await fetchSources(plugin);

		if (data && data.length > 0) {
			await applyData(plugin, data);
		}
	} catch (error) {
		console.log(error);
	}
}

async function fetchSources(plugin: Unearthed) {
	const settings = plugin.settings;

	const response = await fetch(
		"https://unearthed.app/api/public/obsidian-sync",
		{
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${settings.unearthedApiKey}`,
			},
		}
	);

	const data = await response.json();
	return data;
}

async function applyData(plugin: Unearthed, data: UnearthedData[]) {
	const parentFolderPath = `Unearthed/`;

	try {
		if (!plugin.app.vault.getAbstractFileByPath(parentFolderPath)) {
			await plugin.app.vault.createFolder(parentFolderPath);
		}
	} catch (error) {
		console.log(
			`Error creating folder: ${parentFolderPath} - ${error.message}`
		);
	}

	const types = Array.from(
		new Set(
			data.map(
				(item: { type: string }) =>
					item.type.charAt(0).toUpperCase() +
					item.type.slice(1).toLowerCase()
			)
		)
	);

	for (const type of types) {
		const folderPath = `${parentFolderPath}${type}/`;

		try {
			if (!plugin.app.vault.getAbstractFileByPath(folderPath)) {
				await plugin.app.vault.createFolder(folderPath);
			} else {
				console.log(`Folder already exists: ${folderPath}`);
			}
		} catch (error) {
			console.log(
				`Error creating folder: ${parentFolderPath} - ${error.message}`
			);
		}
	}

	for (const item of data) {
		const folderPath = `${parentFolderPath}${
			item.type.charAt(0).toUpperCase() + item.type.slice(1).toLowerCase()
		}/`;
		const fileName = `${item.title}.md`;
		const filePath = `${folderPath}${fileName}`;
		const fileContent = `# ${item.title}\n\n**Author:** [[${item.author}]]\n\n**Source:** ${item.origin}\n\n`;

		let existingQuotes: string[] = [];
		let updatedFileContent = "";

		try {
			const abstractFile =
				plugin.app.vault.getAbstractFileByPath(filePath);

			if (abstractFile instanceof TFile) {
				const fileData = await plugin.app.vault.read(abstractFile);
				existingQuotes = extractExistingQuotes(fileData);

				updatedFileContent = fileData;
			} else {
				updatedFileContent = fileContent;
			}
		} catch (error) {
			console.log(`Error reading file: ${filePath} - ${error.message}`);
			updatedFileContent = fileContent;
		}

		for (const quote of item.quotes) {
			if (!existingQuotes.includes(quote.content)) {
				updatedFileContent += `---\n\n> ${quote.content}\n\n`;
				if (quote.note) {
					updatedFileContent += `**Note:** ${quote.note}\n\n`;
				}
				updatedFileContent += `**Location:** ${quote.location}\n\n`;
			}
		}

		try {
			const abstractFile =
				plugin.app.vault.getAbstractFileByPath(filePath);

			if (abstractFile instanceof TFile) {
				await plugin.app.vault.modify(abstractFile, updatedFileContent);
			} else {
				await plugin.app.vault.create(filePath, updatedFileContent);
			}
		} catch (error) {
			console.log(
				`Error updating or creating file: ${filePath} - ${error.message}`
			);
		}
	}
}

function extractExistingQuotes(fileContent: string): string[] {
	const quoteRegex = />\s(.+?)\n/g;
	const quotes = [];
	let match;
	while ((match = quoteRegex.exec(fileContent)) !== null) {
		quotes.push(match[1].trim());
	}
	return quotes;
}


class UnearthedSettingTab extends PluginSettingTab {
	plugin: Unearthed;

	constructor(app: App, plugin: Unearthed) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Unearthed API Key")
			.setDesc("Copy and paste your API key from unearthed.app")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.unearthedApiKey)
					.onChange(async (value) => {
						this.plugin.settings.unearthedApiKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto Sync")
			.setDesc("Begin the Sync process every time Obsidian is loaded")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoSync)
					.onChange(async (value) => {
						this.plugin.settings.autoSync = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Manual Sync")
			.setDesc("Manually trigger a sync")
			.addButton((button) =>
				button.setButtonText("Sync").onClick(async () => {
					new Notice("Unearthed Sync started, please wait...");
					await syncData(this.plugin);
					new Notice("Unearthed Sync complete");
				})
			);
	}
}
