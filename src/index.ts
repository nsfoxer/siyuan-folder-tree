import {Plugin, showMessage, fetchSyncPost, IMenuBaseDetail} from "siyuan";

interface II18n {
    pluginLoaded: string;
    pluginUnloaded: string;
    uploadCanceled: string;
    error: {
        workspacePath: string;
        depthExceeded: string;
        pathTraversal: string;
        pathEmpty: string;
        workspaceAncestor: string;
        workspaceFile: string;
        handleLink: string;
        noBlockId: string;
        folderOnly: string;
        fileNotExist: string;
        handleFolder: string;
        fileTooLarge: string;
        cannotRead: string;
        readFileFailed: string;
        batchUploadFailed: string;
        uploadFailed: string;
        insertFailed: string;
        unknownTarget: string;
    };
    upload: {
        label: string;
        scanning: string;
        emptyFolder: string;
        foundFiles: string;
        success: string;
        partialFailed: string;
        failedFilesList: string;
    };
    workspaceInitFailed: string;
}

const BATCH_SIZE = 10;
const ASSETS_DIR = "/assets/";
const MAX_DEPTH = 9; // 最大目录深度
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB 文件大小限制

// 通过 window.require 获取 Node.js 模块
const fs = window.require('fs');
const path = window.require('path');

// 常量定义
const FILE_PROTOCOL = "file://";
const HREF_ATTR = "data-href";
const BLOCK_ID_ATTR = "data-node-id";
const HIDDEN_DIRS = new Set(['node_modules', '.git', '.vscode', '.idea']);

interface TreeNode {
    name: string;
    type: "file" | "directory" | "symlink";
    filePath?: string;
    url?: string;
    children?: TreeNode[];
    linkTarget?: string;
}

type FilterFn = (name: string) => boolean;

const defaultFilter: FilterFn = (name) => {
    if (name.startsWith('.') || name.startsWith('~')) return false;
    return !HIDDEN_DIRS.has(name);
};

const fileNameCache = new Map<string, string>();
function getFileName(filePath: string): string {
    let name = fileNameCache.get(filePath);
    if (!name) {
        name = path.basename(filePath);
        fileNameCache.set(filePath, name);
    }
    return name;
}

function clearCache() {
    fileNameCache.clear();
}

export default class NFPlugin extends Plugin{
    // @ts-ignore
    declare i18n: II18n;

    private siyuanWorkspaceDir: string | null = null;
    private normalizedWorkspaceDir: string | null = null;
    private uploadAbortController: AbortController | null = null;
    private failedFiles: string[] = [];

    async onload() {
        this.eventBus.on("open-menu-link", this.handleOpenMenuLink.bind(this));
        this.initSiyuanWorkspaceDir();
    }

    private initSiyuanWorkspaceDir(): void {
        try {
            if (window.siyuan?.config?.system?.workspaceDir) {
                this.siyuanWorkspaceDir = window.siyuan.config.system.workspaceDir;
                this.normalizedWorkspaceDir = path.normalize(this.siyuanWorkspaceDir);
            }
        } catch (err) {
            console.warn(this.i18n.workspaceInitFailed.replace('${error}', String(err)));
        }
    }

    private isInSiyuanWorkspace(filePath: string): boolean {
        if (!this.normalizedWorkspaceDir) return false;
        const normalizedPath = path.normalize(filePath);
        return normalizedPath.startsWith(this.normalizedWorkspaceDir + path.sep);
    }

    private isAncestorOfSiyuanWorkspace(filePath: string): boolean {
        if (!this.normalizedWorkspaceDir) return false;
        const normalizedPath = path.normalize(filePath);
        return this.normalizedWorkspaceDir.startsWith(normalizedPath + path.sep) ||
               normalizedPath === this.normalizedWorkspaceDir;
    }

    private hasPathTraversal(filePath: string): boolean {
        return filePath.includes('..');
    }

    private validatePath(filePath: string): {valid: boolean, error?: string} {
        if (this.hasPathTraversal(filePath)) {
            return {valid: false, error: this.i18n.error.pathTraversal};
        }

        if (!filePath || filePath.trim() === '') {
            return {valid: false, error: this.i18n.error.pathEmpty};
        }

        if (this.isAncestorOfSiyuanWorkspace(filePath)) {
            return {valid: false, error: this.i18n.error.workspaceAncestor};
        }

        if (this.isInSiyuanWorkspace(filePath)) {
            return {valid: false, error: this.i18n.error.workspaceFile};
        }

        return {valid: true};
    }


    private handleOpenMenuLink = async ({detail}: {detail: IMenuBaseDetail}) => {
        const {menu, element} = detail;
        if (!element) return;

        try {
            const href = element.getAttribute(HREF_ATTR);
            if (!href?.startsWith(FILE_PROTOCOL)) return;

            const filePath = decodeURIComponent(href.replace(FILE_PROTOCOL, ""));
            if (!this.isValidFilePath(filePath, element, menu)) return;

        } catch (err) {
            this.logError(this.i18n.error.handleLink, err);
        }
    };

    private isValidFilePath(filePath: string, element: HTMLElement, menu: any): boolean {
        const fileName = getFileName(filePath);
        const blockId = this.findBlockId(element);

        if (!blockId) {
            this.logError(this.i18n.error.noBlockId);
            return false;
        }
        if (!this.isDirectory(filePath)) {
            this.logError(this.i18n.error.folderOnly);
            return false;
        }

        if (!fs.existsSync(filePath)) {
            this.logError(this.i18n.error.fileNotExist.replace('${fileName}', fileName));
            return false;
        }

        const validation = this.validatePath(filePath);
        if (!validation.valid) {
            this.logError(validation.error);
            return false;
        }

        menu.addItem({
            icon: "iconUpload",
            label: this.i18n.upload.label.replace('${fileName}', fileName),
            click: () => this.uploadAndInsert(filePath, blockId),
        });

        return true;
    }

    private findBlockId(element: HTMLElement): string | null {
        let current: HTMLElement | null = element;
        while (current) {
            const blockId = current.getAttribute(BLOCK_ID_ATTR);
            if (blockId) return blockId;
            current = current.parentElement;
        }
        return null;
    }

    private async uploadAndInsert(dirPath: string, blockId: string) {
        const startTime = Date.now();
        clearCache();
        this.failedFiles = [];
        this.uploadAbortController = new AbortController();

        try {
            showMessage(`[${this.name}]: ${this.i18n.upload.scanning}`);
            const {tree, filePaths} = await this.buildDirectoryTree(dirPath, 0);

            if (filePaths.length === 0) {
                showMessage(`[${this.name}]: ${this.i18n.upload.emptyFolder}`);
                return;
            }

            showMessage(`[${this.name}]: ${this.i18n.upload.foundFiles.replace('${count}', String(filePaths.length))}`);
            const urlMap = await this.uploadFilesInBatches(filePaths);

            this.fillTreeUrls(tree, urlMap);

            await this.insertMarkdown(tree, dirPath, blockId);

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

            if (this.failedFiles.length > 0) {
                const failedList = this.failedFiles.map(f => `  - ${f}`).join('\n');
                console.error(`[${this.name}] ${this.i18n.upload.failedFilesList.replace('${files}', failedList)}`);
                showMessage(`[${this.name}]: ${this.i18n.upload.partialFailed
                    .replace('${success}', String(filePaths.length - this.failedFiles.length))
                    .replace('${total}', String(filePaths.length))
                    .replace('${failed}', String(this.failedFiles.length))
                    .replace('${elapsed}', elapsed)
                }`);
            } else {
                showMessage(`[${this.name}]: ${this.i18n.upload.success
                    .replace('${count}', String(filePaths.length))
                    .replace('${elapsed}', elapsed)
                }`);
            }

        } catch (err) {
            const errorMsg = this.getErrorMessage(err);
            showMessage(`[${this.name}]: ${errorMsg}`);
        } finally {
            clearCache();
            this.uploadAbortController = null;
        }
    }

    private isDirectory(dirPath: string): boolean {
        try {
            return fs.statSync(dirPath).isDirectory();
        } catch {
            return false;
        }
    }

    private async buildDirectoryTree(
        dirPath: string,
        currentDepth: number
    ): Promise<{tree: TreeNode[], filePaths: string[]}> {
        if (currentDepth >= MAX_DEPTH) {
            throw new Error(this.i18n.error.depthExceeded
                .replace('${depth}', String(currentDepth + 1))
                .replace('${maxDepth}', String(MAX_DEPTH))
            );
        }

        if (this.uploadAbortController?.signal.aborted) {
            return {tree: [], filePaths: []};
        }

        const entries = await fs.promises.readdir(dirPath, {withFileTypes: true});
        const nodes: TreeNode[] = [];
        const filePaths: string[] = [];
        const subDirs: Array<{name: string, path: string}> = [];

        for (const entry of entries) {
            if (!defaultFilter(entry.name)) continue;

            const fullPath = path.join(dirPath, entry.name);

            try {
                if (entry.isFile()) {
                    const size = fs.statSync(fullPath).size;
                    if (size > MAX_FILE_SIZE) {
                        const sizeMB = (size / 1024 / 1024).toFixed(1);
                        this.logWarn(this.i18n.error.fileTooLarge
                            .replace('${size}', sizeMB)
                            .replace('${fileName}', entry.name)
                        );
                        this.failedFiles.push(fullPath);
                        continue;
                    }
                    filePaths.push(fullPath);
                    nodes.push({name: entry.name, type: "file", filePath: fullPath});
                } else if (entry.isSymbolicLink()) {
                    continue;
                } else if (entry.isDirectory()) {
                    if (currentDepth + 1 >= MAX_DEPTH) {
                        throw new Error(this.i18n.error.depthExceeded
                            .replace('${depth}', String(currentDepth + 2))
                            .replace('${maxDepth}', String(MAX_DEPTH))
                        );
                    }

                    subDirs.push({name: entry.name, path: fullPath});
                }
            } catch (err) {
                this.failedFiles.push(fullPath);
                this.logWarn(this.i18n.error.cannotRead
                    .replace('${fileName}', entry.name)
                    .replace('${error}', this.getErrorMessage(err))
                );
            }
        }

        const MAX_CONCURRENT_SUBDIRS = 3;
        let index = 0;

        const processNext = async (): Promise<void> => {
            while (index < subDirs.length) {
                if (this.uploadAbortController?.signal.aborted) {
                    break;
                }
                const subDir = subDirs[index++];
                const result = await this.buildDirectoryTree(subDir.path, currentDepth + 1);
                nodes.push({name: subDir.name, type: "directory", children: result.tree});
                filePaths.push(...result.filePaths);
            }
        };

        const workers = Array(Math.min(MAX_CONCURRENT_SUBDIRS, subDirs.length))
            .fill(null)
            .map(() => processNext());

        await Promise.all(workers);

        return {tree: nodes, filePaths};
    }

    private fillTreeUrls(tree: TreeNode[], urlMap: Map<string, string>): void {
        for (const node of tree) {
            if (node.type === "file" && node.filePath) {
                const url = urlMap.get(node.filePath);
                if (url) {
                    node.url = url;
                } else {
                    node.filePath = undefined;
                }
            } else if (node.type === "directory" && node.children) {
                this.fillTreeUrls(node.children, urlMap);
            }
        }
    }

    private async uploadFilesInBatches(filePaths: string[]): Promise<Map<string, string>> {
        const allResults = new Map<string, string>();

        const batches: string[][] = [];
        for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
            batches.push(filePaths.slice(i, i + BATCH_SIZE));
        }

        for (let i = 0; i < batches.length; i++) {
            if (this.uploadAbortController?.signal.aborted) {
                break;
            }

            const batchPaths = batches[i];

            const renameMap = this.generateRenameMap(batchPaths);
            const batchResults = await this.uploadSingleBatch(batchPaths, renameMap, i + 1);

            for (const filePath of batchPaths) {
                const uploadedName = renameMap.get(filePath) || getFileName(filePath);
                const url = batchResults.get(uploadedName);

                if (url) {
                    allResults.set(filePath, url);
                } else {
                    this.failedFiles.push(filePath);
                }
            }
        }

        return allResults;
    }

    private generateRenameMap(filePaths: string[]): Map<string, string> {
        const nameCountMap = new Map<string, number>();
        const renameMap = new Map<string, string>();

        for (const filePath of filePaths) {
            const originalName = getFileName(filePath);
            const count = nameCountMap.get(originalName) || 0;
            nameCountMap.set(originalName, count + 1);

            if (count > 0) {
                const ext = path.extname(originalName);
                const baseName = path.basename(originalName, ext);
                const uniqueName = `${baseName}_${count}${ext}`;
                renameMap.set(filePath, uniqueName);
            }
        }

        return renameMap;
    }

    private async uploadSingleBatch(batch: string[], renameMap: Map<string, string>, batchNumber: number): Promise<Map<string, string>> {
        const formData = await this.createFormDataFromPaths(batch, renameMap);
        return this.sendUploadRequest(formData, batchNumber);
    }

    private async createFormDataFromPaths(filePaths: string[], renameMap: Map<string, string>): Promise<FormData> {
        const formData = new FormData();
        formData.append("assetsDirPath", ASSETS_DIR);

        const MAX_CONCURRENT_READS = 5;
        const results: Array<{file: File | null, success: boolean}> = [];

        for (let i = 0; i < filePaths.length; i += MAX_CONCURRENT_READS) {
            const batch = filePaths.slice(i, i + MAX_CONCURRENT_READS);

            const batchPromises = batch.map(async (filePath) => {
                try {
                    if (this.uploadAbortController?.signal.aborted) {
                        return {file: null, success: false};
                    }

                    const buffer = await fs.promises.readFile(filePath);
                    const uploadName = renameMap.get(filePath) || getFileName(filePath);
                    return {file: new File([buffer], uploadName), success: true};
                } catch {
                    this.failedFiles.push(filePath);
                    this.logWarn(this.i18n.error.readFileFailed.replace('${filePath}', filePath));
                    return {file: null, success: false};
                }
            });

            results.push(...await Promise.all(batchPromises));
        }

        for (const result of results) {
            if (result.success && result.file) {
                formData.append("file[]", result.file);
            }
        }

        return formData;
    }

    private async sendUploadRequest(
        formData: FormData,
        batchNumber: number
    ): Promise<Map<string, string>> {
        try {
            const response = await fetch("/api/asset/upload", {
                method: "POST",
                body: formData,
            });
            const result = await response.json();

            if (result.code !== 0) {
                this.logError(this.i18n.error.batchUploadFailed
                    .replace('${batchNumber}', String(batchNumber))
                    .replace('${error}', result.msg || this.i18n.error.uploadFailed)
                );
                return new Map();
            }

            return this.parseUploadResponse(result.data?.succMap || {});

        } catch (err) {
            this.logError(this.i18n.error.batchUploadFailed
                .replace('${batchNumber}', String(batchNumber))
                .replace('${error}', this.getErrorMessage(err))
            );
            return new Map();
        }
    }

    private parseUploadResponse(succMap: Record<string, string>): Map<string, string> {
        const results = new Map<string, string>();
        for (const [name, url] of Object.entries(succMap)) {
            results.set(name, url);
        }
        return results;
    }

    private async insertMarkdown(tree: TreeNode[], dirPath: string, blockId: string): Promise<void> {
        const dirName = getFileName(dirPath);
        const markdown = this.generateTreeMarkdown(tree, dirName);
        await this.insertToEditor(markdown, blockId);
    }

    private generateTreeMarkdown(tree: TreeNode[], rootName: string, indent = 0): string {
        const lines: string[] = [];

        if (indent === 0) {
            lines.push(`- 📁 **${rootName}**`);
        }

        for (const node of tree) {
            this.renderNode(node, indent, lines);
        }

        return lines.join("\n");
    }

    private renderNode(node: TreeNode, indent: number, lines: string[]): void {
        const prefix = "  ".repeat(indent + 1) + "- ";

        if (node.type === "directory") {
            lines.push(`${prefix}📁 **${node.name}**`);
            if (node.children?.length) {
                lines.push(this.generateTreeMarkdown(node.children, "", indent + 1));
            }
        } else if (node.type === "symlink") {
            const target = node.linkTarget || this.i18n.error.unknownTarget;
            lines.push(`${prefix}🔗 ${node.name} → \`${target}\``);
        } else {
            const link = node.url ? `[${node.name}](${node.url})` : `\`${node.name}\``;
            lines.push(`${prefix}${link}`);
        }
    }

    private async insertToEditor(markdown: string, blockId: string): Promise<void> {
        try {
            await fetchSyncPost("/api/block/insertBlock", {
                dataType: "markdown",
                data: markdown,
                previousID: blockId,
            });
        } catch (err) {
            this.logError(this.i18n.error.insertFailed, err);
        }
    }

    private getErrorMessage(err: unknown): string {
        if (err instanceof Error) return err.message;
        return String(err);
    }

    private logError(message: string, err?: unknown): void {
        const errorDetails = err ? `: ${this.getErrorMessage(err)}` : "";
        console.error(`[${this.name}] ${message}${errorDetails}`);
    }

    private logWarn(message: string): void {
        console.warn(`[${this.name}] ${message}`);
    }

    async onunload() {
        this.cancelUpload();

        this.eventBus.off("open-menu-link", this.handleOpenMenuLink);
        clearCache();
    }

    public cancelUpload(): void {
        if (this.uploadAbortController) {
            this.uploadAbortController.abort();
            this.uploadAbortController = null;
            showMessage(`[${this.name}]: ${this.i18n.uploadCanceled}`);
        }
    }
}
