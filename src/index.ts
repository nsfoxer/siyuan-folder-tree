import { Plugin, showMessage, getAllEditor, fetchSyncPost } from "siyuan";

const BATCH_SIZE = 10;
const ASSETS_DIR = "/assets/";

interface TreeNode {
    name: string;
    type: "file" | "directory";
    url?: string;
    children?: TreeNode[];
}

interface FileSystemEntry {
    isFile: boolean;
    isDirectory: boolean;
    name: string;
    createReader(): { readEntries(callback: (entries: FileSystemEntry[]) => void): void };
    file(callback: (file: File) => void, errorCallback: (error: Error) => void): void;
}

export default class NFPlugin extends Plugin {
    private handleDropBindThis: (event: DragEvent) => void;
    private initDropZoneBindThis: () => void;
    private editorElement: HTMLElement | null = null;
    private isInitialized = false;

    async onload() {
        showMessage(`[${this.name}]: 插件已加载`);
        this.handleDropBindThis = this.handleDrop.bind(this);
        this.initDropZoneBindThis = this.initDropZone.bind(this);
        this.eventBus.on("click-editorcontent", this.initDropZoneBindThis);
    }

    private initDropZone() {
        if (this.isInitialized) return;
        const editors = getAllEditor();
        if (editors.length === 0) return;

        this.editorElement = editors[0].protyle.wysiwyg.element;
        this.editorElement.addEventListener("drop", this.handleDropBindThis);
        this.isInitialized = true;
    }

    private async handleDrop(event: DragEvent) {
        event.preventDefault();
        event.stopPropagation();

        const items = event.dataTransfer?.items;
        if (!items?.length) return;

        for (const item of items) {
            // @ts-ignore
            const entry = item.webkitGetAsEntry?.() as FileSystemEntry | undefined;
            if (entry?.isDirectory) {
                showMessage(`[${this.name}]: 正在读取文件夹 - ${entry.name}`);
                await this.processDirectory(entry);
                return;
            }
        }
    }

    private async processDirectory(directoryEntry: FileSystemEntry) {
        try {
            showMessage(`[${this.name}]: 正在处理文件夹...`);
            const tree = await this.readDirectoryTree(directoryEntry);
            const markdown = this.generateTreeMarkdown(tree, directoryEntry.name);
            await this.insertToEditor(markdown);
            showMessage(`[${this.name}]: 已处理 ${this.countFiles(tree)} 个文件`);
        } catch (err) {
            console.error("处理文件夹失败:", err);
            showMessage(`[${this.name}]: 处理失败 - ${err}`);
        }
    }

    private countFiles(tree: TreeNode[]): number {
        return tree.reduce((acc, node) => {
            return acc + (node.type === "file" ? 1 : this.countFiles(node.children || []));
        }, 0);
    }

    private async readDirectoryTree(directoryEntry: FileSystemEntry): Promise<TreeNode[]> {
        const reader = directoryEntry.createReader();
        const allEntries: FileSystemEntry[] = [];

        while (true) {
            const entries = await new Promise<FileSystemEntry[]>(resolve => {
                reader.readEntries(entries => resolve(entries as FileSystemEntry[]));
            });
            if (!entries.length) break;
            allEntries.push(...entries);
        }

        const fileEntries: FileSystemEntry[] = [];
        const nodes: TreeNode[] = [];

        for (const entry of allEntries) {
            if (entry.isFile) {
                fileEntries.push(entry);
            } else if (entry.isDirectory) {
                const children = await this.readDirectoryTree(entry);
                nodes.push({ name: entry.name, type: "directory", children });
            }
        }

        if (fileEntries.length) {
            const urlMap = await this.uploadFiles(fileEntries);
            for (const entry of fileEntries) {
                nodes.push({ name: entry.name, type: "file", url: urlMap.get(entry.name) });
            }
        }

        return nodes;
    }

    private getFileFromFileEntry(entry: FileSystemEntry): Promise<File> {
        return new Promise((resolve, reject) => {
            entry.file(resolve, reject);
        });
    }

    private async uploadFiles(entries: FileSystemEntry[]): Promise<Map<string, string>> {
        const allResults = new Map<string, string>();

        for (let i = 0; i < entries.length; i += BATCH_SIZE) {
            const batch = entries.slice(i, i + BATCH_SIZE);
            const formData = new FormData();
            formData.append("assetsDirPath", ASSETS_DIR);

            const files = await Promise.all(batch.map(e => this.getFileFromFileEntry(e)));
            files.forEach(file => formData.append("file[]", file));

            const response = await fetch("/api/asset/upload", { method: "POST", body: formData });
            const result = await response.json();

            if (result.code !== 0) {
                throw new Error(result.msg || "上传失败");
            }

            Object.entries(result.data.succMap || {}).forEach(([name, url]: [string, string]) => {
                allResults.set(name, url);
            });
        }

        return allResults;
    }

    private generateTreeMarkdown(tree: TreeNode[], rootName: string, indent = 0): string {
        const lines: string[] = [];

        if (indent === 0) {
            lines.push(`- 📁 **${rootName}**`);
        }

        for (const node of tree) {
            const prefix = "  ".repeat(indent + 1) + "- ";
            if (node.type === "directory") {
                lines.push(`${prefix}📁 **${node.name}**`);
                if (node.children?.length) {
                    lines.push(this.generateTreeMarkdown(node.children, "", indent + 1));
                }
            } else {
                lines.push(node.url ? `${prefix}[${node.name}](${node.url})` : `${prefix}\`${node.name}\``);
            }
        }

        return lines.join("\n");
    }

    private async insertToEditor(markdown: string) {
        const editors = getAllEditor();
        if (editors.length === 0) {
            showMessage(`[${this.name}]: 没有打开的编辑器`);
            return;
        }

        const protyle = editors[0].protyle;
        const rootId = protyle.block?.rootID || protyle.wysiwyg?.element?.firstElementChild?.getAttribute("data-node-id");

        if (!rootId) {
            showMessage(`[${this.name}]: 无法获取文档 ID`);
            return;
        }

        try {
            await fetchSyncPost("/api/block/appendBlock", {
                dataType: "markdown",
                data: markdown,
                parentID: rootId,
            });
        } catch (err) {
            console.error("插入内容失败:", err);
            showMessage(`[${this.name}]: 插入失败`);
        }
    }

    async onunload() {
        if (this.editorElement) {
            this.editorElement.removeEventListener("drop", this.handleDropBindThis);
        }
        this.eventBus.off("click-editorcontent", this.initDropZoneBindThis);
        this.isInitialized = false;
        this.editorElement = null;
        showMessage(`[${this.name}]: 插件已卸载`);
    }
}
