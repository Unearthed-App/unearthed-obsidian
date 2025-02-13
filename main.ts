import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
	Plugin,
	TFile,
	requestUrl,
	TFolder,
} from "obsidian";

interface UnearthedSettings {
	unearthedApiKey: string;
	autoSync: boolean;
	dailyReflectionDateFormat: string;
	dailyReflectionLocation: string;
	addDailyReflection: boolean;
	quoteTemplate: string;
	sourceTemplate: string;
	sourceFilenameTemplate: string;
	sourceFilenameLowercase: boolean;
	sourceFilenameReplaceSpaces: string;
	lastSyncDate: string;
	dailyReflectionTemplate: string;
	secret: string;
}

const QUOTE_TEMPLATE_EXAMPLE = `
---
> {{content}}

**Note:** {{note}}
**Location:** {{location}}
`;

const DAILY_REFLECTION_TEMPLATE_EXAMPLE = `
## Daily Reflection

> {{quote}}

**{{type}}:** [[{{source}}]]
**Author:** [[{{author}}]]
**Location:** {{location}}

**Note:** {{note}}

---
`;

const SOURCE_TEMPLATE_OPTIONS = [
	"title",
	"subtitle",
	"author",
	"type",
	"origin",
	"asin",
	"ignored",
	"createdAt",
];

const HIDDEN_CHAR = "\u200B";

const DEFAULT_SETTINGS: UnearthedSettings = {
	unearthedApiKey: "",
	autoSync: false,
	dailyReflectionDateFormat: "YYYY-MM-DD",
	dailyReflectionLocation: "Daily Notes",
	addDailyReflection: false,
	quoteTemplate: "",
	sourceTemplate: "",
	sourceFilenameTemplate: "{{title}}",
	sourceFilenameLowercase: true,
	sourceFilenameReplaceSpaces: "-",
	lastSyncDate: "",
	dailyReflectionTemplate: "",
	secret: "",
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
	asin: string;
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

interface DailyReflection {
	type: string;
	source: string;
	author: string;
	quote: string;
	note: string;
	location: string;
}

interface SafeFileNameOptions {
	replacement?: string;
	lowercase?: boolean;
	trimSpaces?: boolean;
	collapseSpaces?: boolean;
}

export default class Unearthed extends Plugin {
	settings: UnearthedSettings;

	async onload() {
		await this.loadSettings();

		const getLocalDateStr = () => window.moment().format("YYYY-MM-DD");

		this.app.workspace.onLayoutReady(async () => {
			const currentDate = getLocalDateStr();
			if (
				!window
					.moment(this.settings.lastSyncDate, "YYYY-MM-DD")
					.isSame(window.moment(), "day")
			) {
				if (this.settings.addDailyReflection) {
					await getAndAppendDailyReflection(this);
				}

				if (this.settings.autoSync) {
					new Notice("Unearthed Sync started, please wait...");
					await syncData(this);
					new Notice("Unearthed Sync complete");

					this.settings.lastSyncDate = currentDate;

					await this.saveSettings();
				}
			}
		});

		this.addRibbonIcon(
			"book",
			"Kindle (Unearthed) Sync",
			async (evt: MouseEvent) => {
				new Notice("Unearthed Sync started, please wait...");
				await getAndAppendDailyReflection(this);
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
	await checkConnection(plugin);
	try {
		const { data } = await fetchSources(plugin);

		if (data && data.length > 0) {
			await applyData(plugin, data);
		}
	} catch (error) {
		// error
	}
}

async function fetchSources(plugin: Unearthed) {
	const settings = plugin.settings;

	const response = await requestUrl({
		url: "https://unearthed.app/api/public/obsidian-get",
		method: "GET",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${settings.unearthedApiKey}~~~${settings.secret}`,
		},
	});

	return response.json;
}

async function applyData(plugin: Unearthed, data: UnearthedData[]) {
	const parentFolderPath = `Unearthed/`;

	try {
		const abstractFile =
			plugin.app.vault.getAbstractFileByPath(parentFolderPath);
		if (!abstractFile || !(abstractFile instanceof TFolder)) {
			await plugin.app.vault.createFolder(parentFolderPath);
		}
	} catch (error) {
		// No folder created
	}

	const types = Array.from(
		new Set(
			data.map((item: { type: string }) =>
				firstLetterUppercase(item.type)
			)
		)
	);

	for (const type of types) {
		const folderPath = `${parentFolderPath}${type}s/`;

		try {
			if (!plugin.app.vault.getAbstractFileByPath(folderPath)) {
				await plugin.app.vault.createFolder(folderPath);
			} else {
				// No folder created
			}
		} catch (error) {
			// No folder created
		}
	}

	for (const item of data) {
		const folderPath = `${parentFolderPath}${firstLetterUppercase(
			item.type
		)}s/`;

		const fileName = SOURCE_TEMPLATE_OPTIONS.reduce((acc, key) => {
			const value = item[key as keyof UnearthedData];
			const stringValue =
				typeof value === "string" ? value : String(value); // Ensure it's a string

			return acc.replace(new RegExp(`{{${key}}}`, "g"), stringValue);
		}, plugin.settings.sourceFilenameTemplate);
		const filePath = `${folderPath}${toSafeFileName(plugin, fileName)}.md`;

		let fileContent = `# ${item.title}\n\n**Author:** [[${
			item.author
		}]]\n\n**Source:** ${firstLetterUppercase(item.origin)}\n\n`;

		if (plugin.settings.sourceTemplate) {
			fileContent = SOURCE_TEMPLATE_OPTIONS.reduce((acc, key) => {
				const value = item[key as keyof UnearthedData];
				const stringValue =
					typeof value === "string" ? value : String(value); // Ensure it's a string

				return acc.replace(new RegExp(`{{${key}}}`, "g"), stringValue);
			}, plugin.settings.sourceTemplate);
		}

		let existingQuotes: string[] = [];
		let updatedFileContent = "";

		try {
			const abstractFile =
				plugin.app.vault.getAbstractFileByPath(filePath);

			if (abstractFile instanceof TFile) {
				const fileData = await plugin.app.vault.read(abstractFile);

				if (plugin.settings.quoteTemplate) {
					existingQuotes =
						extractExistingQuotesUsingTemplate(fileData);
				} else {
					existingQuotes = extractExistingQuotes(fileData);
				}

				updatedFileContent = fileData;
			} else {
				updatedFileContent = fileContent;
			}
		} catch (error) {
			updatedFileContent = fileContent;
		}

		const template = plugin.settings.quoteTemplate;

		if (plugin.settings.quoteTemplate) {
			for (const quote of item.quotes) {
				let gotTemplate = template;

				const hiddenContent = `${HIDDEN_CHAR}${quote.content}${HIDDEN_CHAR}`;

				if (!existingQuotes.includes(quote.content)) {
					gotTemplate = gotTemplate.replace(
						"{{content}}",
						hiddenContent
					);
					if (quote.note) {
						gotTemplate = gotTemplate.replace(
							"{{note}}",
							quote.note
						);
					} else {
						gotTemplate = gotTemplate.replace("{{note}}", "");
					}
					gotTemplate = gotTemplate.replace(
						"{{location}}",
						quote.location
					);
					updatedFileContent += "\n" + gotTemplate;
				}
			}
		} else {
			for (const quote of item.quotes) {
				if (!existingQuotes.includes(quote.content)) {
					updatedFileContent += `---\n\n> ${quote.content}\n\n`;
					if (quote.note) {
						updatedFileContent += `**Note:** ${quote.note}\n\n`;
					}
					updatedFileContent += `**Location:** ${quote.location}\n\n`;
				}
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
			// Error updating or creating file
		}
	}
}

async function checkConnection(plugin: Unearthed) {
	new Notice("Checking connection...");

	if (!plugin.settings.secret) {
		try {
			const connectResults = await requestUrl({
				url: "https://unearthed.app/api/public/connect",
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${plugin.settings.unearthedApiKey}`,
				},
			});

			if (connectResults.status === 200) {
				plugin.settings.secret = connectResults.json.data.secret;
				await plugin.saveSettings();
				new Notice("Connected successfully!");
			} else {
				new Notice(
					"Failed to connect to Unearthed. Status: " + connectResults.status
				);
				console.error(
					"Failed to connect to Unearthed. Status:",
					connectResults.status
				);
			}
		} catch (error) {
			new Notice("Could not connect to Unearthed.");
			console.error("Error connecting to Unearthed:", error);
		}
	}
}

async function getAndAppendDailyReflection(plugin: Unearthed) {
	await checkConnection(plugin);
	if (!plugin.settings.dailyReflectionLocation) {
		new Notice("Please specify a Daily Note folder location");
		return;
	}

	if (!plugin.settings.dailyReflectionDateFormat) {
		new Notice("Please specify a Daily Note date format");
		return;
	}

	const dailyReflection = await fetchDailyReflection(plugin);

	if (!dailyReflection) {
		return;
	}

	const formattedDate = window
		.moment(new Date())
		.format(plugin.settings.dailyReflectionDateFormat);

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
	reflection: DailyReflection
) {
	const file = plugin.app.vault.getAbstractFileByPath(filePath);
	let content = "";

	if (file instanceof TFile) {
		content = await plugin.app.vault.read(file);
	} else {
		new Notice("Daily note does not exist");
		return;
	}

	let reflectionContent = `
---
## Daily Reflection

> "${reflection.quote}"

**${firstLetterUppercase(reflection.type)}:** [[${reflection.source}]]
**Author:** [[${reflection.author}]]
**Location:** ${reflection.location}

**Note:** ${reflection.note}

---
`;

	if (plugin.settings.dailyReflectionTemplate) {
		reflectionContent = plugin.settings.dailyReflectionTemplate;
		reflectionContent = reflectionContent.replace(
			"{{quote}}",
			reflection.quote
		);
		reflectionContent = reflectionContent.replace(
			"{{type}}",
			firstLetterUppercase(reflection.type)
		);
		reflectionContent = reflectionContent.replace(
			"{{source}}",
			reflection.source
		);
		reflectionContent = reflectionContent.replace(
			"{{author}}",
			reflection.author
		);
		reflectionContent = reflectionContent.replace(
			"{{location}}",
			reflection.location
		);
		reflectionContent = reflectionContent.replace(
			"{{note}}",
			reflection.note ? reflection.note : ""
		);
		reflectionContent = reflectionContent.replace(
			"{{dailyReflectionContent}}",
			`> "${reflection.quote}"\n\n**${firstLetterUppercase(
				reflection.type
			)}:** [[${reflection.source}]]\n**Author:** [[${
				reflection.author
			}]]\n**Location:** ${reflection.location}\n\n**Note:** ${
				reflection.note
			}`
		);
	}

	const hiddenReflectionContent = `${HIDDEN_CHAR}${reflectionContent}${HIDDEN_CHAR}`;

	let existingReflection = false;
	if (plugin.settings.dailyReflectionTemplate) {
		existingReflection = extractExistingDailyReflectionUsingTemplate(
			content,
			plugin.settings.dailyReflectionTemplate
		);
	} else {
		existingReflection = content.includes("## Daily Reflection");
	}

	if (!existingReflection) {
		content += hiddenReflectionContent;
		await plugin.app.vault.modify(file, content);
	}
}

async function fetchDailyReflection(plugin: Unearthed) {
	const settings = plugin.settings;

	const response = await requestUrl({
		url: "https://unearthed.app/api/public/daily-reflection",
		method: "GET",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${settings.unearthedApiKey}~~~${settings.secret}`,
		},
	});

	const { data } = response.json;

	if (!data || !data.dailyReflection || typeof data === "undefined") {
		return false;
	}

	return {
		type: data.dailyReflection.source.type,
		source: data.dailyReflection.source.title,
		author: data.dailyReflection.source.author,
		quote: data.dailyReflection.quote.content,
		note: data.dailyReflection.quote.note,
		location: data.dailyReflection.quote.location,
	} as DailyReflection;
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

function extractExistingQuotesUsingTemplate(fileContent: string): string[] {
	const quoteRegex = new RegExp(`${HIDDEN_CHAR}(.+?)${HIDDEN_CHAR}`, "g");
	const quotes = [];
	let match;

	while ((match = quoteRegex.exec(fileContent)) !== null) {
		const quote = match[1].trim();
		quotes.push(quote);
	}

	return quotes;
}

function extractExistingDailyReflectionUsingTemplate(
	fileContent: string,
	template: string
): boolean {
	if (!template) {
		return fileContent.includes("## Daily Reflection");
	}
	const reflectionRegex = new RegExp(
		`${HIDDEN_CHAR}(.*?)${HIDDEN_CHAR}`,
		"gs"
	);
	const match = reflectionRegex.exec(fileContent);
	return match !== null;
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
			.setName("Unearthed API key")
			.setDesc("Copy and paste your API key from unearthed.app")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.unearthedApiKey)
					.onChange(async (value) => {
						this.plugin.settings.unearthedApiKey = value;
						this.plugin.settings.secret = "";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto sync")
			.setDesc("Begin the sync process every time obsidian is loaded")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoSync)
					.onChange(async (value) => {
						this.plugin.settings.autoSync = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("Add daily reflection to daily note on startup")
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
			.setName("Daily reflection (date format)")
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
			.setName("Daily reflection (new file location)")
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
			.setName("Manual sync")
			.setDesc("Manually trigger a sync")
			.addButton((button) =>
				button.setButtonText("Sync").onClick(async () => {
					new Notice("Unearthed Sync started, please wait...");
					await syncData(this.plugin);
					new Notice("Unearthed Sync complete");
				})
			);
		new Setting(containerEl)
			.setName("Manual daily reflection sync")
			.setDesc("Manually trigger a sync for the Daily Reflection")
			.addButton((button) =>
				button.setButtonText("Sync").onClick(async () => {
					new Notice("Unearthed Sync started, please wait...");
					await getAndAppendDailyReflection(this.plugin);
					new Notice("Complete - check your daily note");
				})
			);

		new Setting(containerEl)
			.setName("Filename template")
			.setDesc(
				"The template used to format the filename for each source(book). Press 'Insert Options' to append the available options."
			)
			.addButton((button) =>
				button.setButtonText("Insert Options").onClick(async () => {
					for (const option of SOURCE_TEMPLATE_OPTIONS) {
						this.plugin.settings.sourceFilenameTemplate += `{{${option}}}\n`;
					}
					await this.plugin.saveSettings();
					this.display();
				})
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter filename template")
					.setValue(this.plugin.settings.sourceFilenameTemplate)
					.onChange(async (value) => {
						this.plugin.settings.sourceFilenameTemplate = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Filename lowercase")
			.setDesc("Save source(book) filenames in lowercase")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.sourceFilenameLowercase)
					.onChange(async (value) => {
						this.plugin.settings.sourceFilenameLowercase = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Filename replace spaces with")
			.setDesc(
				"Enter a character to replace spaces and invalid characters with"
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter character")
					.setValue(this.plugin.settings.sourceFilenameReplaceSpaces)
					.onChange(async (value) => {
						this.plugin.settings.sourceFilenameReplaceSpaces =
							value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Source(book) template")
			.setDesc(
				"The template used to format each source(book). Press 'Insert Options' to append the available options."
			)
			.addButton((button) =>
				button.setButtonText("Insert Options").onClick(async () => {
					for (const option of SOURCE_TEMPLATE_OPTIONS) {
						this.plugin.settings.sourceTemplate += `{{${option}}}\n`;
					}
					await this.plugin.saveSettings();
					this.display();
				})
			)
			.addTextArea(
				(textArea) =>
					(textArea
						.setValue(this.plugin.settings.sourceTemplate)
						.onChange(async (value) => {
							this.plugin.settings.sourceTemplate = value;
							await this.plugin.saveSettings();
						}).inputEl.style.height = "200px")
			);

		new Setting(containerEl)
			.setName("Quote template")
			.setDesc(
				"The template used to format each individual quote/note. Placeholders: {{quote}}, {{note}}, {{location}}. Press 'Insert Template' button for an example."
			)
			.addButton((button) =>
				button.setButtonText("Insert Template").onClick(async () => {
					this.plugin.settings.quoteTemplate = QUOTE_TEMPLATE_EXAMPLE;
					await this.plugin.saveSettings();
					this.display();
				})
			)
			.addTextArea(
				(textArea) =>
					(textArea
						.setValue(this.plugin.settings.quoteTemplate)
						.onChange(async (value) => {
							this.plugin.settings.quoteTemplate = value;
							await this.plugin.saveSettings();
						}).inputEl.style.height = "200px")
			);

		new Setting(containerEl)
			.setName("Daily reflection template")
			.setDesc(
				"The template used to format the daily reflection section in your daily note. Placeholders: {{quote}}, {{type}}, {{source}}, {{author}}, {{location}}, {{note}}. Press 'Insert Template' button for an example."
			)
			.addButton((button) =>
				button.setButtonText("Insert Template").onClick(async () => {
					this.plugin.settings.dailyReflectionTemplate =
						DAILY_REFLECTION_TEMPLATE_EXAMPLE;
					await this.plugin.saveSettings();
					this.display();
				})
			)
			.addTextArea(
				(textArea) =>
					(textArea
						.setValue(this.plugin.settings.dailyReflectionTemplate)
						.onChange(async (value) => {
							this.plugin.settings.dailyReflectionTemplate =
								value;
							await this.plugin.saveSettings();
						}).inputEl.style.height = "200px")
			);

		new Setting(containerEl)
			.setName("Last auto sync date")
			.setDesc(
				this.plugin.settings.lastSyncDate
					? this.plugin.settings.lastSyncDate
					: "Never"
			);
	}
}

function toSafeFileName(
	plugin: Unearthed,
	str: string,
	options: SafeFileNameOptions = {}
): string {
	if (typeof str !== "string") {
		throw new Error("Input must be a string");
	}

	const defaults = {
		replacement: plugin.settings.sourceFilenameReplaceSpaces
			? plugin.settings.sourceFilenameReplaceSpaces
			: " ",
		lowercase: plugin.settings.sourceFilenameLowercase,
		trimSpaces: true,
		collapseSpaces: true,
	};

	const opts = { ...defaults, ...options };
	let result = str;

	// Convert to lowercase if specified
	if (opts.lowercase) {
		result = result.toLowerCase();
	}

	// Replace invalid characters
	// Windows/Unix invalid chars: \ / : * ? " < > |
	result = result.replace(/[\\/:"*?<>|]/g, opts.replacement);

	// Handle control characters without using regex
	const safeChars = result
		.split("")
		.map((char) => {
			const code = char.charCodeAt(0);
			return code < 32 || code === 127 ? opts.replacement : char;
		})
		.join("");

	result = safeChars;

	// Replace spaces if specified
	if (opts.collapseSpaces) {
		result = result.replace(/\s+/g, " ");
	}

	// Trim spaces if specified
	if (opts.trimSpaces) {
		result = result.trim();
	}

	// Replace remaining spaces with replacement character
	result = result.replace(/\s/g, opts.replacement);

	// Collapse multiple replacement characters
	const escapedReplacement = opts.replacement.replace(
		/[.*+?^${}()|[\]\\]/g,
		"\\$&"
	);
	result = result.replace(
		new RegExp(`${escapedReplacement}+`, "g"),
		opts.replacement
	);

	// Trim replacement characters from ends
	result = result.replace(
		new RegExp(`^${escapedReplacement}+|${escapedReplacement}+$`, "g"),
		""
	);

	return result;
}

function firstLetterUppercase(str: string) {
	return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
