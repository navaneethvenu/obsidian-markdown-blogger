import {
	App,
	Editor,
	FuzzySuggestModal,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface PathMapping {
	name: string;
	sourcePath: string;
	destinationPath: string;
}
interface MarkdownBloggerSettings {
	pathMappings: PathMapping[];
	basePath: string;
	defaultProjectFolder: string;
	showHiddenFolders: boolean;
}

const DEFAULT_SETTINGS: MarkdownBloggerSettings = {
	pathMappings: [],
	basePath: "",
	defaultProjectFolder: "",
	showHiddenFolders: false,
};
enum Action {
	Push,
	Pull,
}

export default class MarkdownBlogger extends Plugin {
	settings: MarkdownBloggerSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "validate-path",
			name: "Validate path",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const { defaultProjectFolder: projectFolder } = this.settings;
				validatePath(projectFolder);
			},
		});

		this.addCommand({
			id: "push-md",
			name: "Push markdown",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const { defaultProjectFolder: projectFolder } = this.settings;
				if (!fs.existsSync(projectFolder)) {
					new ErrorModal(this.app).open();
					return;
				}
				const text = editor.getDoc().getValue();
				const projectBlogPath = path.resolve(
					this.settings.defaultProjectFolder,
					view.file!.name
				);
				try {
					fs.writeFileSync(`${projectBlogPath}`, text, {
						encoding: "utf8",
					});
					new Notice(
						`Your file has been pushed! At ${projectBlogPath}`
					);
				} catch (err) {
					new Notice(err.message);
				}
			},
		});

		this.addCommand({
			id: "push-md-folder",
			name: "Push folder",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const {
					defaultProjectFolder: projectFolder,
					basePath,
					pathMappings,
				} = this.settings;

				validatePath(projectFolder, false);

				// Check if there is an active file
				const activeFilePath = view.file?.path;
				if (!activeFilePath) {
					new Notice("No active file found.");
					return;
				}

				const parentFolderPath = path.dirname(activeFilePath);

				let destinationFolderPath = path.resolve(
					projectFolder,
					path.basename(parentFolderPath)
				);

				const completeParentFolderPath = path.join(
					basePath,
					parentFolderPath
				);

				new Notice(path.dirname(completeParentFolderPath));

				const pathMapping = pathMappings.find(
					(mapping) =>
						mapping.sourcePath ===
						path.dirname(completeParentFolderPath)
				);

				if (pathMapping) {
					validatePath(pathMapping.destinationPath, false);

					destinationFolderPath = path.resolve(
						pathMapping.destinationPath,
						path.basename(parentFolderPath)
					);
				}

				try {
					// Create the destination folder if it doesn't exist
					if (!fs.existsSync(destinationFolderPath)) {
						fs.mkdirSync(destinationFolderPath, {
							recursive: true,
						});
					}

					// Copy contents from the parent folder to the target folder
					fs.readdirSync(completeParentFolderPath).forEach((file) => {
						const sourceFilePath = path.join(
							completeParentFolderPath,
							file
						);

						const destinationFilePath = path.join(
							destinationFolderPath,
							file
						);

						if (fs.lstatSync(sourceFilePath).isDirectory()) {
							// Recursively copy subdirectories
							fs.cpSync(sourceFilePath, destinationFilePath, {
								recursive: true,
							});
						} else if (
							file.endsWith(".md") ||
							file.endsWith(".mdx")
						) {
							// Process markdown files
							processMDFile(
								sourceFilePath,
								parentFolderPath,
								file,
								destinationFilePath
							);
						} else {
							// Copy files
							fs.copyFileSync(
								sourceFilePath,
								destinationFilePath
							);
						}
					});

					new Notice(
						`Your folder has been pushed! At ${destinationFolderPath}`
					);
				} catch (err) {
					new Notice(`Ergror: ${err.message}`);
				}
			},
		});

		this.addCommand({
			id: "pull-md",
			name: "Pull markdown",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const { defaultProjectFolder: projectFolder } = this.settings;
				if (!fs.existsSync(projectFolder)) {
					new ErrorModal(this.app).open();
					return;
				}
				const projectBlogPath = path.resolve(
					projectFolder,
					view.file!.name
				);

				if (fs.existsSync(projectBlogPath)) {
					try {
						const file = fs.readFileSync(projectBlogPath, "utf8");
						editor.getDoc().setValue(file);
						new Notice(
							`Your file has been pulled! From ${projectBlogPath}`
						);
					} catch (err) {
						new Notice(err.message);
					}
					return true;
				}
				new Notice(`Oops ${projectFolder}`);
				return false;
			},
		});

		this.addCommand({
			id: "push-custom-path-md",
			name: "Push to custom path",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				new PathModal(this.app, this.settings, Action.Push).open();
			},
		});

		this.addCommand({
			id: "pull-custom-path",
			name: "Pull from custom path",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				new PathModal(this.app, this.settings, Action.Pull).open();
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new MarkdownBloggerSettingTab(this.app, this));
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

class ErrorModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText(
			"The project folder does not exist. Please create the path or update the current path in plugin settings."
		);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class PathModal extends FuzzySuggestModal<string> {
	currPath = os.homedir();
	settings: MarkdownBloggerSettings;
	action: Action;

	constructor(app: App, settings: MarkdownBloggerSettings, action: Action) {
		super(app);
		this.settings = settings;
		this.action = action;
	}

	getItems(): string[] {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);

		const paths = fs.readdirSync(this.currPath).filter((p) => {
			const fullPath = path.resolve(this.currPath, p);
			let stats;
			try {
				stats = fs.statSync(fullPath, { throwIfNoEntry: false });
			} catch (e) {
				return false;
			}
			if (stats === undefined) return false;
			return (
				(stats.isDirectory() ||
					path.basename(fullPath) === view?.file!.name) &&
				(p[0] !== "." || this.settings.showHiddenFolders)
			);
		});

		paths.push("..");
		paths.push("Select");

		return paths;
	}
	getItemText(dir: string): string {
		return dir;
	}
	onChooseItem(dir: string, evt: MouseEvent | KeyboardEvent) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (dir === "Select") {
			if (view) {
				if (!fs.existsSync(path.resolve(this.currPath))) {
					new ErrorModal(this.app).open();
					return;
				}

				const text = view.editor.getDoc().getValue();
				const filePath = path.resolve(this.currPath, view.file!.name);
				if (this.action === Action.Push) {
					try {
						fs.writeFileSync(`${filePath}`, text, {
							encoding: "utf8",
						});
						new Notice(`Your file has been pushed! At ${filePath}`);
					} catch (err) {
						new Notice(err.message);
					}
				} else if (this.action === Action.Pull) {
					try {
						const file = fs.readFileSync(filePath, "utf8");
						view.editor.getDoc().setValue(file);
						new Notice(
							`Your file has been pulled! From ${filePath}`
						);
					} catch (err) {
						new Notice(err.message);
					}
				}
			}
			return;
		} else if (view && dir === view.file!.name) {
			const filePath = path.resolve(this.currPath, view.file!.name);
			if (this.action === Action.Push) {
				const text = view.editor.getDoc().getValue();
				try {
					fs.writeFileSync(`${filePath}`, text, { encoding: "utf8" });
					new Notice(`Your file has been pushed! At ${filePath}`);
				} catch (err) {
					new Notice(err.message);
				}
			} else if (this.action === Action.Pull) {
				try {
					const file = fs.readFileSync(filePath, "utf8");
					view.editor.getDoc().setValue(file);
					new Notice(`Your file has been pulled! From ${filePath}`);
				} catch (err) {
					new Notice(err.message);
				}
			}
			return;
		} else {
			this.currPath = path.normalize(path.join(this.currPath, dir));
		}
		this.open();
	}
}

class MarkdownBloggerSettingTab extends PluginSettingTab {
	plugin: MarkdownBlogger;

	constructor(app: App, plugin: MarkdownBlogger) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", {
			text: "Settings for Obsidian Markdown Blogger.",
		});

		new Setting(containerEl)
			.setName("Base Path to your Obsidian Vault")
			.setDesc(
				"The local project folder for your obsidian vault. Must be an absolute path."
			)
			.addText((text) =>
				text
					.setPlaceholder(
						"/Users/johnsample/projects/astro-blog/collections/"
					)
					.setValue(this.plugin.settings.basePath)
					.onChange(async (value) => {
						this.plugin.settings.basePath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Default Local project folder path")
			.setDesc(
				"The local project folder for your blog, portfolio, or static site. Must be an absolute path."
			)
			.addText((text) =>
				text
					.setPlaceholder(
						"/Users/johnsample/projects/astro-blog/collections/"
					)
					.setValue(this.plugin.settings.defaultProjectFolder)
					.onChange(async (value) => {
						this.plugin.settings.defaultProjectFolder = value;
						await this.plugin.saveSettings();
					})
			);

		// Add a section for path mappings
		containerEl.createEl("h3", { text: "Path Mappings" });

		// Add button to create new mapping
		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText("Add New Mapping").onClick(async () => {
				this.plugin.settings.pathMappings.push({
					name: `Mapping ${
						this.plugin.settings.pathMappings.length + 1
					}`,
					sourcePath: "",
					destinationPath: "",
				});
				await this.plugin.saveSettings();
				this.display();
			})
		);

		// Display existing mappings
		// Display existing mappings
		this.plugin.settings.pathMappings.forEach((mapping, index) => {
			const mappingContainer = containerEl.createDiv();
			mappingContainer.addClass("path-mapping-container");

			const setting = new Setting(mappingContainer)
				.addText((text) =>
					text
						.setPlaceholder("Source path")
						.setValue(mapping.sourcePath)
						.onChange(async (value) => {
							this.plugin.settings.pathMappings[
								index
							].sourcePath = value;
							await this.plugin.saveSettings();
						})
				)
				.addText((text) =>
					text
						.setPlaceholder("Destination path")
						.setValue(mapping.destinationPath)
						.onChange(async (value) => {
							this.plugin.settings.pathMappings[
								index
							].destinationPath = value;
							await this.plugin.saveSettings();
						})
				)

				.addExtraButton((cb) => {
					cb.setIcon("cross")
						.setTooltip("Delete")
						.onClick(async () => {
							this.plugin.settings.pathMappings.splice(index, 1);
							await this.plugin.saveSettings();
							this.display();
						});
				});
		});
		new Setting(containerEl)
			.setName("Show hidden folders")
			.setDesc("Show hidden folders when pushing to a custom path")
			.addToggle((cb) =>
				cb
					.setValue(this.plugin.settings.showHiddenFolders)
					.onChange(async (value) => {
						this.plugin.settings.showHiddenFolders = value;
						await this.plugin.saveSettings();
					})
			);
	}
}

function validatePath(path: string, showNotice?: boolean) {
	if (!fs.existsSync(path)) {
		new ErrorModal(this.app).open();
		throw new Error(`Path does not exist: ${path}`);
	}
	if (showNotice ?? true) new Notice(`Valid path: ${path}`);
}

function processMDFile(
	sourceFilePath: string,
	parentFolderPath: string,
	file: string,
	destinationFilePath: string
) {
	let content = fs.readFileSync(sourceFilePath, "utf8");
	const customURLPrefix = `/work/${path.basename(parentFolderPath)}/`;

	// Replace image paths with custom URL prefix
	content = content.replace(
		/!\[[^\]]*\]\((images\/[^\)]+)\)/g,
		(match, p1) => {
			const customURLPrefix = `/work/${path.basename(parentFolderPath)}/`;
			return match.replace(p1, `${customURLPrefix}${p1}`);
		}
	);

	// Append/modify the front matter for cover_url
	const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	let frontMatter = frontMatterMatch ? frontMatterMatch[1] : "";
	let body = frontMatterMatch
		? content.slice(frontMatterMatch[0].length)
		: content;

	let updatedFrontMatter = frontMatter;

	const coverUrlMatch = frontMatter.match(/cover_url:\s*(.*)/);
	if (coverUrlMatch) {
		let coverUrl = coverUrlMatch[1].trim();
		if (!coverUrl.startsWith("http") && !coverUrl.startsWith("/")) {
			coverUrl = path.join(
				customURLPrefix,
				coverUrl.replace(/^"\[\[|\]\]"$/g, "")
			);
		}
		updatedFrontMatter = frontMatter.replace(
			/cover_url:\s*".*?"/,
			`cover_url: ${coverUrl}`
		);
	} else {
		updatedFrontMatter += `\ncover_url: `;
	}

	// Combine the updated front matter and body
	content = `---\n${updatedFrontMatter}\n---\n${body}`;

	//add wrappers around content
	content = wrapWithCustomComponent(content);

	// Write the modified content to the target folder
	let targetExtension = ".mdx";
	let updatedDestinationPath = path.join(
		path.dirname(destinationFilePath),
		path.basename(file, path.extname(file)) + targetExtension
	);

	fs.writeFileSync(updatedDestinationPath, content, {
		encoding: "utf8",
	});
}

function wrapWithCustomComponent(
	content: string,
	wrapper: string = "ContentWrapper",
	headingWrapper: string = "HeadingWrapper"
): string {
	// Regex to identify blocks that shouldn't be wrapped
	const frontMatterRegex = /^---[\s\S]*?---$/m;
	const imageRegex = /^!\[.*?\]\(.*?\)$/m;
	const componentRegex = /<([a-zA-Z0-9-]+)([^>]*?)(\/?)>/; // Matches custom tags (including self-closing)
	const headingRegex = /^(#{1,2})\s+(.*)$/m; // Matches h1 (#) and h2 (##)

	// Split content into blocks by double newlines
	const blocks = content.split(/\n\s*\n/);
	let result: string[] = [];

	let currentBlock = "";
	for (const block of blocks) {
		const trimmedBlock = block.trim();

		// Check if the block is a heading
		const headingMatch = headingRegex.exec(trimmedBlock);
		if (headingMatch) {
			const hashes = headingMatch[1]; // # or ##
			const headingContent = headingMatch[2]; // Heading text
			const headingTag = `<${headingWrapper}>\n${hashes} ${headingContent}\n</${headingWrapper}>`;

			// Push any current block before adding the heading
			if (currentBlock) {
				result.push(
					`<${wrapper}>\n${currentBlock.trim()}\n</${wrapper}>`
				);
				currentBlock = "";
			}

			// Add the heading wrapper
			result.push(headingTag);
			continue;
		}

		// Check if the block contains front matter, images, or custom components
		if (
			frontMatterRegex.test(trimmedBlock) ||
			imageRegex.test(trimmedBlock) ||
			componentRegex.test(trimmedBlock)
		) {
			// If we have a current block, wrap and push it before adding new content
			if (currentBlock) {
				result.push(
					`<${wrapper}>\n${currentBlock.trim()}\n</${wrapper}>`
				);
				currentBlock = "";
			}
			// Leave these blocks untouched (custom components, front matter, images)
			result.push(trimmedBlock);
		} else {
			// Group consecutive paragraphs without wrapping them individually
			if (currentBlock) {
				currentBlock += "\n\n" + trimmedBlock;
			} else {
				currentBlock = trimmedBlock;
			}
		}
	}

	// Push any remaining block
	if (currentBlock) {
		result.push(`<${wrapper}>\n${currentBlock.trim()}\n</${wrapper}>`);
	}

	return result.join("\n\n");
}
