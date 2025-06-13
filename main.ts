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

type QuoteColorMode = "none" | "background" | "text";

type ColorKey = "yellow" | "blue" | "pink" | "orange";

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
	rootFolder: string;
	quoteColorMode: QuoteColorMode;
	customColors: Record<ColorKey, string>;
}

const QUOTE_TEMPLATE_EXAMPLE = `
---
> {{content}}

**Note:** {{note}}
**Location:** {{location}}
**Color:** {{color}}
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
const sourceIdToFileName = new Map<string, string>();

const HIDDEN_CHAR = "\u200B";

const DEFAULT_COLOR_MAP: Record<string, string> = {
	yellow: "#ffd700",
	blue: "#4682b4",
	pink: "#ff69b4",
	orange: "#ffa500",
};

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
	rootFolder: "Unearthed",
	quoteColorMode: "background",
	customColors: {
		yellow: DEFAULT_COLOR_MAP.yellow,
		blue: DEFAULT_COLOR_MAP.blue,
		pink: DEFAULT_COLOR_MAP.pink,
		orange: DEFAULT_COLOR_MAP.orange,
	},
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

interface UnearthedTagData {
	id: string;
	userId: string;
	title: string;
	description: string;
	createdAt: Date;
	sourceIds: string[];
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
	sourceId: string;
	author: string;
	quote: string;
	note: string;
	location: string;
	color: string;
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
				try {
					if (this.settings.addDailyReflection) {
						await getAndAppendDailyReflection(this);
					}

					if (this.settings.autoSync) {
						new Notice("Unearthed Sync started, please wait...");
						this.performBackgroundSync(currentDate);
					}
				} catch (error) {
					console.error("Error during startup sync:", error);
					new Notice(
						"Unearthed startup sync failed. Check console for details."
					);
				}
			}
		});

		this.addRibbonIcon("book", "Kindle (Unearthed) Sync", async () => {
			new Notice("Unearthed Sync started, please wait...");
			await getAndAppendDailyReflection(this);
			await syncData(this);
			new Notice("Unearthed Sync complete");
		});

		this.addSettingTab(new UnearthedSettingTab(this.app, this));
	}

	onunload() {}

	async performBackgroundSync(currentDate: string) {
		try {
			await syncData(this);
			new Notice("Unearthed Sync complete");
			this.settings.lastSyncDate = currentDate;
			await this.saveSettings();
		} catch (error) {
			console.error("Background sync failed:", error);
			new Notice("Unearthed Sync failed. Check console for details.");
		}
	}

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

async function syncData(plugin: Unearthed, applyTheData = true) {
	try {
		await checkConnection(plugin);

		new Notice("Fetching sources...");
		const { data } = await fetchSources(plugin);

		new Notice("Fetching tags...");
		const tagsData = await fetchTags(plugin);

		sourceIdToFileName.clear();

		if (data && data.length > 0) {
			new Notice(`Processing ${data.length} sources...`);
			for (const item of data) {
				const fileName = SOURCE_TEMPLATE_OPTIONS.reduce((acc, key) => {
					const value = item[key as keyof UnearthedData];
					const stringValue =
						typeof value === "string" ? value : String(value);
					return acc.replace(
						new RegExp(`{{${key}}}`, "g"),
						stringValue
					);
				}, plugin.settings.sourceFilenameTemplate);
				const safeFileName = toSafeFileName(plugin, fileName);

				sourceIdToFileName.set(item.id, safeFileName);
			}

			if (applyTheData) {
				new Notice("Creating/updating source files...");
				await applyData(plugin, data);
			}
		}

		if (tagsData && tagsData.length > 0) {
			if (applyTheData) {
				new Notice(`Processing ${tagsData.length} tags...`);
				await applyTags(plugin, tagsData);
			}
		}
	} catch (error) {
		console.error("Sync error:", error);
		new Notice("Sync failed. Check console for details.");
		throw error;
	}
}

async function requestWithTimeout(
	requestParams: Parameters<typeof requestUrl>[0],
	timeoutMs = 30000
) {
	return Promise.race([
		requestUrl(requestParams),
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error("Request timeout")), timeoutMs)
		),
	]);
}

async function fetchSources(plugin: Unearthed) {
	const settings = plugin.settings;

	const response = (await requestWithTimeout(
		{
			url: "https://unearthed.app/api/public/obsidian-get",
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${settings.unearthedApiKey}~~~${settings.secret}`,
			},
		},
		30000
	)) as { json: { data: UnearthedData[] } };

	return response.json;
}

async function fetchTags(plugin: Unearthed) {
	const settings = plugin.settings;

	try {
		const response = (await requestWithTimeout(
			{
				url: "https://unearthed.app/api/public/obsidian-get-tags",
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${settings.unearthedApiKey}~~~${settings.secret}`,
				},
			},
			30000
		)) as { json: { success: boolean; data: UnearthedTagData[] } };

		const tagsResponse = response.json;

		if (tagsResponse.success) {
			return tagsResponse.data;
		} else {
			return [];
		}
	} catch (error) {
		console.error("Error fetching tags:", error);
		return [];
	}
}

async function applyData(plugin: Unearthed, data: UnearthedData[]) {
	const parentFolderPath = `${plugin.settings.rootFolder}/`;

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

	for (let i = 0; i < data.length; i++) {
		const item = data[i];

		if (i % 5 === 0) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}

		const folderPath = `${parentFolderPath}${firstLetterUppercase(
			item.type
		)}s/`;

		const fileName = SOURCE_TEMPLATE_OPTIONS.reduce((acc, key) => {
			const value = item[key as keyof UnearthedData];
			const stringValue =
				typeof value === "string" ? value : String(value);
			return acc.replace(new RegExp(`{{${key}}}`, "g"), stringValue);
		}, plugin.settings.sourceFilenameTemplate);
		const filePath = `${folderPath}${toSafeFileName(plugin, fileName)}.md`;

		let fileContent = `# ${item.title}\n\n**Author:** [[${
			item.author
		}]]\n\n**Source:** ${firstLetterUppercase(item.origin)}\n\n`;

		if (plugin.settings.sourceTemplate) {
			fileContent =
				SOURCE_TEMPLATE_OPTIONS.reduce((acc, key) => {
					const value = item[key as keyof UnearthedData] ?? "";
					const stringValue =
						typeof value === "string" ? value : String(value);

					if (key.startsWith("createdAt")) {
						const createdAtValues = acc.match(
							/{{createdAt(\w*|\|date:\w*-\w*-\w*)}}/g
						);

						if (createdAtValues) {
							for (const template of createdAtValues) {
								if (template.includes("|date:")) {
									const format =
										template.match(/\|date:(.+?)}}/)?.[1];
									const formattedDate = window
										.moment(stringValue)
										.format(format);
									acc = acc.replace(template, formattedDate);
								} else {
									acc = acc.replace(template, stringValue);
								}
							}
							return acc;
						}
					} else {
						return acc.replace(
							new RegExp(`{{${key}}}`, "g"),
							stringValue
						);
					}
				}, plugin.settings.sourceTemplate) ?? "";
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
					let styledContent = hiddenContent;
					if (
						plugin.settings.quoteColorMode !== "none" &&
						quote.color
					) {
						const colorLower = quote.color.toLowerCase();
						let colorHex = "";

						for (const colorKey of Object.keys(
							DEFAULT_COLOR_MAP
						) as ColorKey[]) {
							if (colorLower.includes(colorKey)) {
								colorHex =
									plugin.settings.customColors[colorKey] ||
									DEFAULT_COLOR_MAP[colorKey];
								break;
							}
						}

						if (colorHex) {
							if (
								plugin.settings.quoteColorMode === "background"
							) {
								styledContent = `<div style="background-color: ${colorHex}; padding: 12px;">${hiddenContent}</div>`;
							} else if (
								plugin.settings.quoteColorMode === "text"
							) {
								styledContent = `<span style="color: ${colorHex};">${hiddenContent}</span>`;
							}
						}
					}

					gotTemplate = gotTemplate.replace(
						"{{content}}",
						styledContent
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
					if (quote.color) {
						gotTemplate = gotTemplate.replace(
							"{{color}}",
							quote.color
						);
					} else {
						gotTemplate = gotTemplate.replace("{{color}}", "");
					}
					updatedFileContent += "\n" + gotTemplate;
				}
			}
		} else {
			for (const quote of item.quotes) {
				if (!existingQuotes.includes(quote.content)) {
					let styledContent = `> ${quote.content}`;

					if (
						plugin.settings.quoteColorMode !== "none" &&
						quote.color
					) {
						const colorLower = quote.color.toLowerCase();
						let colorHex = "";

						for (const colorKey of Object.keys(
							DEFAULT_COLOR_MAP
						) as ColorKey[]) {
							if (colorLower.includes(colorKey)) {
								colorHex =
									plugin.settings.customColors[colorKey] ||
									DEFAULT_COLOR_MAP[colorKey];
								break;
							}
						}

						if (colorHex) {
							if (
								plugin.settings.quoteColorMode === "background"
							) {
								styledContent = `> <div style="background-color: ${colorHex}; padding: 12px;">${quote.content}</div>`;
							} else if (
								plugin.settings.quoteColorMode === "text"
							) {
								styledContent = `> <span style="color: ${colorHex};">${quote.content}</span>`;
							}
						}
					}

					updatedFileContent += `---\n\n${styledContent}\n\n`;
					if (quote.note) {
						updatedFileContent += `**Note:** ${quote.note}\n\n`;
					}
					updatedFileContent += `**Location:** ${quote.location}\n\n`;
					if (quote.color) {
						updatedFileContent += `**Color:** ${quote.color}\n\n`;
					}
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

async function applyTags(plugin: Unearthed, data: UnearthedTagData[]) {
	const parentFolderPath = `${plugin.settings.rootFolder}/Tags/`;

	try {
		const abstractFile =
			plugin.app.vault.getAbstractFileByPath(parentFolderPath);
		if (!abstractFile || !(abstractFile instanceof TFolder)) {
			await plugin.app.vault.createFolder(parentFolderPath);
		}
	} catch (error) {
		// No folder created
	}

	for (let i = 0; i < data.length; i++) {
		const tag = data[i];

		if (i % 3 === 0) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}

		let fileName = toSafeFileName(plugin, tag.title);
		fileName = await fileExists(plugin, fileName);

		const filePath = `${parentFolderPath}${fileName}.md`;

		// Check if the tag file already exists in the Tags folder
		const tagFile = plugin.app.vault.getAbstractFileByPath(filePath);
		if (tagFile instanceof TFile) {
			continue;
		}

		// Create the initial content for the tag file
		let fileContent = `# ${tag.title}\n\n`;

		// Add description if available
		if (tag.description) {
			fileContent += `${tag.description}\n\n`;
		}

		// Add sources section if there are any source IDs
		if (tag.sourceIds && tag.sourceIds.length > 0) {
			fileContent += `## Sources\n\n`;

			// Try to find source files in the root directory
			const sourcesFolder = `${plugin.settings.rootFolder}/`;
			const sourceFolders = await plugin.app.vault.adapter.list(
				sourcesFolder
			);

			// Keep track of sources we've found
			const foundSources: string[] = [];

			// Search for source files in all subfolders
			if (sourceFolders && sourceFolders.folders) {
				for (const folder of sourceFolders.folders) {
					// Skip the Tags folder
					if (folder === parentFolderPath) continue;

					try {
						const folderContents =
							await plugin.app.vault.adapter.list(folder);
						if (folderContents && folderContents.files) {
							for (const file of folderContents.files) {
								if (file.endsWith(".md")) {
									const fileContent =
										await plugin.app.vault.adapter.read(
											file
										);

									// Check if this file contains any of our source IDs
									for (const sourceId of tag.sourceIds) {
										if (fileContent.includes(sourceId)) {
											// Extract the title from the file path
											const fileName =
												file
													.split("/")
													.pop()
													?.replace(".md", "") ||
												"Unknown";

											// Make sure we're not adding a tag file as a source
											if (!folder.includes(`Tags`)) {
												foundSources.push(
													`- [[${fileName}]]\n`
												);
											}
											break;
										}
									}
								}
							}
						}
					} catch (error) {
						// Skip this folder if there's an error
					}
				}
			}

			// Add the sources we found
			if (foundSources.length > 0) {
				// Remove any duplicates
				const uniqueSources = [...new Set(foundSources)];
				for (const source of uniqueSources) {
					fileContent += source;
				}
			} else {
				// If we didn't find any sources directly, try to use the sourceIdToFileName mapping
				let foundMappedSources = false;
				for (const sourceId of tag.sourceIds) {
					// Try to get the filename from the mapping
					const fileName = sourceIdToFileName.get(sourceId);
					if (fileName) {
						fileContent += `- [[${fileName}]]\n`;
						foundMappedSources = true;
					}
				}

				// If we still didn't find any sources, just list the IDs
				if (!foundMappedSources) {
					for (const sourceId of tag.sourceIds) {
						// Try to create a safe filename from the sourceId
						const safeSourceId = toSafeFileName(plugin, sourceId);
						fileContent += `- [[${safeSourceId}]]\n`;
					}
				}
			}
		}

		// Check if the file already exists
		try {
			const abstractFile =
				plugin.app.vault.getAbstractFileByPath(filePath);

			if (abstractFile instanceof TFile) {
				// File exists, update it
				await plugin.app.vault.modify(abstractFile, fileContent);
			} else {
				// File doesn't exist, create it
				await plugin.app.vault.create(filePath, fileContent);
			}
		} catch (error) {
			// Error handling file, try to create it
			try {
				await plugin.app.vault.create(filePath, fileContent);
			} catch (createError) {
				// Failed to create file
			}
		}
	}
}

async function listFolders(plugin: Unearthed) {
	const folders = await plugin.app.vault.adapter.list(
		`${plugin.settings.rootFolder}/`
	);
	return folders.folders;
}

async function fileExists(plugin: Unearthed, fileName: string) {
	const listOfFolders = await listFolders(plugin);

	const filteredFolders = listOfFolders.filter(
		(folder) => folder !== `${plugin.settings.rootFolder}/Tags`
	);

	let counter = 1;
	for (const folder of filteredFolders) {
		const files = await plugin.app.vault.adapter.list(folder);

		if (files.files.includes(`${folder}/${fileName}.md`)) {
			let newFileName = `${fileName}-${counter}`;

			while (files.files.includes(`${folder}/${newFileName}.md`)) {
				counter++;
				newFileName = `${fileName}-${counter}`;
			}

			if (folder === filteredFolders[filteredFolders.length - 1]) {
				return newFileName;
			}
		}
	}

	return fileName;
}

async function checkConnection(plugin: Unearthed) {
	new Notice("Checking connection...");

	if (!plugin.settings.secret) {
		try {
			const connectResults = (await requestWithTimeout(
				{
					url: "https://unearthed.app/api/public/connect",
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${plugin.settings.unearthedApiKey}`,
					},
				},
				15000
			)) as { status: number; json: { data: { secret: string } } };

			if (connectResults.status === 200) {
				plugin.settings.secret = connectResults.json.data.secret;
				await plugin.saveSettings();
				new Notice("Connected successfully!");
			} else {
				new Notice(
					"Failed to connect to Unearthed. Status: " +
						connectResults.status
				);
				console.error(
					"Failed to connect to Unearthed. Status:",
					connectResults.status
				);
				throw new Error(
					`Connection failed with status: ${connectResults.status}`
				);
			}
		} catch (error) {
			new Notice(
				"Could not connect to Unearthed. Check your API key and internet connection."
			);
			console.error("Error connecting to Unearthed:", error);
			throw error;
		}
	}
}

async function getAndAppendDailyReflection(plugin: Unearthed) {
	try {
		await checkConnection(plugin);
		if (!plugin.settings.dailyReflectionLocation) {
			new Notice("Please specify a Daily Note folder location");
			return;
		}

		if (!plugin.settings.dailyReflectionDateFormat) {
			new Notice("Please specify a Daily Note date format");
			return;
		}

		await syncData(plugin, false);

		const dailyReflection = await fetchDailyReflection(plugin);

		if (!dailyReflection) {
			new Notice("No daily reflection available");
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
	} catch (error) {
		console.error("Error in getAndAppendDailyReflection:", error);
		new Notice("Daily reflection sync failed. Check console for details.");
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

	const sourceFile =
		sourceIdToFileName.get(reflection.sourceId) || reflection.source;

	let styledQuote = reflection.quote;

	if (plugin.settings.quoteColorMode !== "none" && reflection.color) {
		const colorLower = reflection.color.toLowerCase();
		let colorHex = "";

		for (const colorKey of Object.keys(DEFAULT_COLOR_MAP) as ColorKey[]) {
			if (colorLower.includes(colorKey)) {
				colorHex =
					plugin.settings.customColors[colorKey] ||
					DEFAULT_COLOR_MAP[colorKey];
				break;
			}
		}

		if (colorHex) {
			if (plugin.settings.quoteColorMode === "background") {
				styledQuote = `<div style="background-color: ${colorHex}; padding: 12px;">${reflection.quote}</div>`;
			} else if (plugin.settings.quoteColorMode === "text") {
				styledQuote = `<span style="color: ${colorHex};">${reflection.quote}</span>`;
			}
		}
	}

	let reflectionContent = `
---
## Daily Reflection

> "${styledQuote}"

**${firstLetterUppercase(reflection.type)}:** [[${sourceFile}]]
**Author:** [[${reflection.author}]]
**Location:** ${reflection.location}

**Note:** ${reflection.note}

---
`;

	if (plugin.settings.dailyReflectionTemplate) {
		reflectionContent = plugin.settings.dailyReflectionTemplate;
		reflectionContent = reflectionContent.replace("{{quote}}", styledQuote);
		reflectionContent = reflectionContent.replace(
			"{{type}}",
			firstLetterUppercase(reflection.type)
		);
		reflectionContent = reflectionContent.replace("{{source}}", sourceFile);
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
			`> "${styledQuote}"\n\n**${firstLetterUppercase(
				reflection.type
			)}:** [[${sourceFile}]]\n**Author:** [[${
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

	const response = (await requestWithTimeout(
		{
			url: "https://unearthed.app/api/public/daily-reflection",
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${settings.unearthedApiKey}~~~${settings.secret}`,
			},
		},
		30000
	)) as {
		json: {
			data: {
				dailyReflection: {
					source: {
						type: string;
						title: string;
						id: string;
						author: string;
					};
					quote: {
						content: string;
						note: string;
						location: string;
						color?: string;
					};
				};
			};
		};
	};

	const { data } = response.json;

	if (!data || !data.dailyReflection || typeof data === "undefined") {
		return false;
	}

	return {
		type: data.dailyReflection.source.type,
		source: data.dailyReflection.source.title,
		sourceId: data.dailyReflection.source.id,
		author: data.dailyReflection.source.author,
		quote: data.dailyReflection.quote.content,
		note: data.dailyReflection.quote.note,
		location: data.dailyReflection.quote.location,
		color: data.dailyReflection.quote.color || "",
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
			.setName("Manual tag sync")
			.setDesc("Manually link tags to source files")
			.addButton((button) =>
				button.setButtonText("Link Tags").onClick(async () => {
					new Notice("Syncing and linking tags, please wait...");

					await syncData(this.plugin, false);
					const tagsData = await fetchTags(this.plugin);

					if (tagsData && tagsData.length > 0) {
						await applyTags(this.plugin, tagsData);
					}
					new Notice("Tags linked to sources successfully");
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

						if (option == "createdAt") {
							this.plugin.settings.sourceTemplate +=
								"{{createdAt|date:YYYY-MM-DD}}\n";
						}
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
				"The template used to format each individual quote/note. Placeholders: {{content}}, {{note}}, {{location}}, {{color}}. Press 'Insert Template' button for an example."
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
			.setName("Root folder")
			.setDesc(
				"The root folder where all Unearthed content will be stored"
			)
			.addSearch((cb) => {
				cb.setPlaceholder("Default: Unearthed")
					.setValue(this.plugin.settings.rootFolder)
					.onChange(async (newFolder) => {
						this.plugin.settings.rootFolder =
							newFolder || "Unearthed";
						await this.plugin.saveSettings();
					});
				cb.inputEl.type = "text";
				cb.inputEl.setAttribute("data-type", "folder");
			});

		const quoteColorSetting = new Setting(containerEl)
			.setName("Quote color styling")
			.setDesc(
				"Choose how to apply color styling to quotes based on their highlight color"
			);

		quoteColorSetting.addDropdown((dropdown) => {
			dropdown
				.addOption("none", "No color styling")
				.addOption("background", "Apply as background color")
				.addOption("text", "Apply as text color")
				.setValue(this.plugin.settings.quoteColorMode)
				.onChange(async (value: QuoteColorMode) => {
					this.plugin.settings.quoteColorMode = value;
					await this.plugin.saveSettings();
				});
		});

		new Setting(containerEl)
			.setName("Custom highlight colors")
			.setDesc("Customize the colors used for each highlight type");

		const colorNames: ColorKey[] = ["yellow", "blue", "pink", "orange"];
		for (const colorName of colorNames) {
			new Setting(containerEl)
				.setName(
					`${
						colorName.charAt(0).toUpperCase() + colorName.slice(1)
					} highlight`
				)
				.addText((text) => {
					const input = text
						.setPlaceholder(DEFAULT_COLOR_MAP[colorName])
						.setValue(this.plugin.settings.customColors[colorName])
						.onChange(async (value) => {
							this.plugin.settings.customColors[colorName] =
								value;
							await this.plugin.saveSettings();
						});

					input.inputEl.type = "color";
					input.inputEl.style.width = "50px";
					input.inputEl.style.height = "24px";

					const resetButton = createEl("button");
					resetButton.textContent = "Reset";
					resetButton.style.marginLeft = "10px";
					resetButton.addEventListener("click", async () => {
						this.plugin.settings.customColors[colorName] =
							DEFAULT_COLOR_MAP[colorName];
						input.setValue(DEFAULT_COLOR_MAP[colorName]);
						await this.plugin.saveSettings();
					});
					input.inputEl.parentElement?.appendChild(resetButton);
				});
		}

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
