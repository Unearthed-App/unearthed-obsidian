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
	dailyReflectionDateFormat: string;
	dailyReflectionLocation: string;
	addDailyReflection: boolean;
}

const DEFAULT_SETTINGS: UnearthedSettings = {
	unearthedApiKey: "",
	autoSync: false,
	dailyReflectionDateFormat: "YYYY-MM-DD",
	dailyReflectionLocation: "Daily Notes",
	addDailyReflection: false,
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

			if (this.settings.addDailyReflection) {
				await getAndAppendDailyReflection(this);
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
			`No folder created: ${parentFolderPath} - ${error.message}`
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
				console.log(`No folder created: ${folderPath}`);
			}
		} catch (error) {
			console.log(
				`No folder created: ${parentFolderPath} - ${error.message}`
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

function formatDate(date: Date, format: string): string {
	const pad = (n: number): string => (n < 10 ? `0${n}` : n.toString());
	const map: { [key: string]: string } = {
		YYYY: date.getFullYear().toString(),
		MM: pad(date.getMonth() + 1),
		DD: pad(date.getDate()),
		HH: pad(date.getHours()),
		mm: pad(date.getMinutes()),
		ss: pad(date.getSeconds()),
	};

	return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (matched) => map[matched]);
}

async function getAndAppendDailyReflection(plugin: Unearthed) {
	if (!plugin.settings.dailyReflectionLocation) {
		new Notice("Please specify a Daily Note folder location");
		return;
	}

	if (!plugin.settings.dailyReflectionDateFormat) {
		new Notice("Please specify a Daily Note date format");
		return;
	}

	const dailyReflection = await fetchDailyReflection(plugin);
	const formattedDate = formatDate(
		new Date(),
		plugin.settings.dailyReflectionDateFormat
	);
	const filePath = `${plugin.settings.dailyReflectionLocation}/${formattedDate}.md`;

	try {
		await appendToDailyNote(plugin, filePath, dailyReflection);
		new Notice("Daily reflection added successfully");
	} catch (error) {
		console.error("Error appending daily reflection:", error);
		new Notice("Failed to add daily reflection");
	}
}

async function appendToDailyNote(
	plugin: Unearthed,
	filePath: string,
	reflection: any
) {
	const file = plugin.app.vault.getAbstractFileByPath(filePath);
	let content = "";

	if (file instanceof TFile) {
		content = await plugin.app.vault.read(file);
	} else {
		new Notice("Daily note does not exist");
		return;
	}

	const reflectionContent = `
---
## Daily Reflection

> "${reflection.quote}"

**Book:** [[${reflection.book}]]
**Author:** [[${reflection.author}]]
**Location:** ${reflection.location}

**Note:** ${reflection.note}

---
`;

	if (!content.includes("## Daily Reflection")) {
		content += reflectionContent;
		await plugin.app.vault.modify(file as TFile, content);
	} else {
		console.log("Daily Reflection section already exists in the note.");
	}
}

async function fetchDailyReflection(plugin: Unearthed) {
	const settings = plugin.settings;

	const response = await fetch(
		"http://localhost:3000/api/public/get-daily",
		// "https://unearthed.app/api/public/get-daily",
		{
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${settings.unearthedApiKey}`,
			},
		}
	);

	const { data } = await response.json();
	console.log("SDFGSDFGDFGDFG", data);

	if (!data || !data.dailyReflection) {
		return {};
	}

	return {
		book: data.dailyReflection.source.title,
		author:	data.dailyReflection.source.author,
		quote: data.dailyReflection.quote.content,
		note: data.dailyReflection.quote.note,
		location: data.dailyReflection.quote.location,
	};
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
			.setName("Add Daily Reflection to Daily note on startup")
			.setDesc(
				"Automatically add a Daily Reflection section to your Daily note when Obsidian starts"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.addDailyReflection)
					.onChange(async (value) => {
						this.plugin.settings.addDailyReflection = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Daily Reflection (Date Format)")
			.setDesc(
				"The format of the daily note file name. You can copy this from the Core->Daily notes plugin settings"
			)
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD")
					.setValue(this.plugin.settings.dailyReflectionDateFormat)
					.onChange(async (value) => {
						this.plugin.settings.dailyReflectionDateFormat = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Daily Reflection (New file location)")
			.setDesc(
				"The folder of your Daily notes. You can copy this from the Core->Daily notes plugin settings."
			)
			.addSearch((cb) => {
				cb.setPlaceholder("Example: Daily Notes/")
					.setValue(this.plugin.settings.dailyReflectionLocation)
					.onChange(async (newFolder) => {
						this.plugin.settings.dailyReflectionLocation =
							newFolder;
						await this.plugin.saveSettings();
					});
				cb.inputEl.type = "text";
				cb.inputEl.setAttribute("data-type", "folder");
			});

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
		new Setting(containerEl)
			.setName("Manual Daily Reflection Sync")
			.setDesc("Manually trigger a sync for the Daily Reflection")
			.addButton((button) =>
				button.setButtonText("Sync").onClick(async () => {
					new Notice("Unearthed Sync started, please wait...");
					await getAndAppendDailyReflection(this.plugin);
					new Notice("Complete - check your daily note");

				})
			);
	}
}
