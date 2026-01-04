import {Plugin, showMessage, fetchSyncPost, IMenuBaseDetail} from "siyuan";

const BATCH_SIZE = 10;
const ASSETS_DIR = "/assets/";
const MAX_DEPTH = 7; // 最大目录深度

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
    type: "file" | "directory" | "symlink"; // 添加 symlink 类型
    url?: string;
    children?: TreeNode[];
    linkTarget?: string; // 符号链接目标路径
}

type FilterFn = (name: string) => boolean;

// 默认文件过滤器：跳过隐藏文件和系统目录
const defaultFilter: FilterFn = (name) => {
    if (name.startsWith('.') || name.startsWith('~')) return false;
    return !HIDDEN_DIRS.has(name);
};

// 缓存文件名，避免重复计算
const fileNameCache = new Map<string, string>();
function getFileName(filePath: string): string {
    let name = fileNameCache.get(filePath);
    if (!name) {
        name = path.basename(filePath);
        fileNameCache.set(filePath, name);
    }
    return name;
}

// 清理缓存（在操作完成后调用）
function clearCache() {
    fileNameCache.clear();
}

// 工作区错误类
class WorkspacePathError extends Error {
    constructor() {
        super('不允许上传思源工作目录下的文件');
        this.name = 'WorkspacePathError';
    }
}

export default class NFPlugin extends Plugin{

    private siyuanWorkspaceDir: string | null = null;

    async onload() {
        showMessage(`[${this.name}]: 插件已加载`);
        this.eventBus.on("open-menu-link", this.handleOpenMenuLink.bind(this));
        // 获取思源工作目录
        this.initSiyuanWorkspaceDir();
    }

    // 初始化思源工作目录
    private initSiyuanWorkspaceDir(): void {
        try {
            if (window.siyuan?.config?.system?.workspaceDir) {
                this.siyuanWorkspaceDir = window.siyuan.config.system.workspaceDir;
                return;
            }
        } catch (err) {
            console.warn("初始化思源工作目录失败:", err);
        }
    }

    // 检查路径是否在思源工作目录下
    private isInSiyuanWorkspace(filePath: string): boolean {
        if (!this.siyuanWorkspaceDir) return false;

        // 规范化路径进行比较
        const normalizedPath = path.normalize(filePath);
        const normalizedWorkspace = path.normalize(this.siyuanWorkspaceDir);

        return normalizedPath.startsWith(normalizedWorkspace + path.sep) ||
               normalizedPath === normalizedWorkspace;
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
            this.logError("处理链接失败", err);
        }
    };

    private isValidFilePath(filePath: string, element: HTMLElement, menu: any): boolean {
        const fileName = getFileName(filePath);
        const blockId = this.findBlockId(element);

        if (!blockId) {
            this.logError("无法获取块 ID");
            return false;
        }

        if (!fs.existsSync(filePath)) {
            showMessage(`[${this.name}]: 文件不存在: ${fileName}`);
            return false;
        }

        menu.addItem({
            icon: "iconUpload",
            label: `上传本地资源: ${fileName}`,
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
        clearCache(); // 清理缓存

        try {
            // 检查是否在思源工作目录下
            if (this.isInSiyuanWorkspace(dirPath)) {
                throw new WorkspacePathError();
            }

            if (!this.isDirectory(dirPath)) {
                showMessage(`[${this.name}]: 仅支持文件夹上传`);
                return;
            }

            showMessage(`[${this.name}]: 正在检查文件夹深度...`);
            const maxDepth = await this.checkDirectoryDepth(dirPath);

            if (maxDepth > MAX_DEPTH) {
                showMessage(`[${this.name}]: 文件夹深度超过限制 (${MAX_DEPTH}层)，不允许上传`);
                return;
            }

            showMessage(`[${this.name}]: 正在扫描文件夹...`);
            const tree = await this.buildDirectoryTree(dirPath, 0);
            const totalFiles = this.countFiles(tree);

            if (totalFiles === 0) {
                showMessage(`[${this.name}]: 文件夹为空或无可上传文件`);
                return;
            }

            showMessage(`[${this.name}]: 正在上传 ${totalFiles} 个文件...`);
            await this.insertMarkdown(tree, dirPath, blockId);

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            showMessage(`[${this.name}]: 已上传 ${totalFiles} 个文件 (耗时 ${elapsed}s)`);

        } catch (err) {
            this.logError("处理文件夹失败", err);
            const errorMsg = this.getErrorMessage(err);
            showMessage(`[${this.name}]: ${errorMsg}`);
        } finally {
            clearCache(); // 确保清理缓存
        }
    }

    // 检查目录树的最大深度
    private async checkDirectoryDepth(dirPath: string, currentDepth = 1): Promise<number> {
        let maxDepth = currentDepth;

        try {
            const entries = await fs.promises.readdir(dirPath, {withFileTypes: true});

            for (const entry of entries) {
                // 只检查目录，忽略文件和符号链接
                if (entry.isDirectory() && defaultFilter(entry.name)) {
                    const fullPath = path.join(dirPath, entry.name);

                    // 跳过思源工作目录下的文件夹
                    if (this.isInSiyuanWorkspace(fullPath)) {
                        continue;
                    }

                    // 使用 lstat 检查是否为符号链接
                    const lstat = fs.lstatSync(fullPath);
                    if (lstat.isSymbolicLink()) {
                        continue;
                    }

                    // 递归检查子目录深度
                    const childDepth = await this.checkDirectoryDepth(fullPath, currentDepth + 1);
                    maxDepth = Math.max(maxDepth, childDepth);

                    // 提前终止：如果已经超过限制，直接返回
                    if (maxDepth > MAX_DEPTH) {
                        return maxDepth;
                    }
                }
            }
        } catch (err) {
            // 忽略检查错误
        }

        return maxDepth;
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
    ): Promise<TreeNode[]> {
        const entries = await fs.promises.readdir(dirPath, {withFileTypes: true});
        const nodes: TreeNode[] = [];
        const filePaths: string[] = [];
        const subDirs: Array<{name: string, path: string}> = [];

        // 分类收集文件和目录
        for (const entry of entries) {
            if (!defaultFilter(entry.name)) continue;

            const fullPath = path.join(dirPath, entry.name);

            // 使用 lstat 检查符号链接
            const lstat = fs.lstatSync(fullPath);

            if (lstat.isSymbolicLink()) {
                // 符号链接，不上传但记录
                const target = fs.readlinkSync(fullPath);
                nodes.push({
                    name: entry.name,
                    type: "symlink",
                    linkTarget: target
                });
            } else if (entry.isFile()) {
               filePaths.push(fullPath);
            } else if (entry.isDirectory()) {
                // 检查子目录是否在思源工作目录下
                if (this.isInSiyuanWorkspace(fullPath)) {
                    this.logWarn(`跳过思源工作目录下的文件夹: ${entry.name}`);
                    continue;
                }
                // 收集子目录，稍后处理
                subDirs.push({name: entry.name, path: fullPath});
            }
        }

        // 批量上传当前目录的文件
        await this.uploadBatchFiles(filePaths, nodes);

        // 串行处理子目录
        for (const subDir of subDirs) {
            await this.processDirectory(subDir.path, subDir.name, nodes, currentDepth + 1);
        }

        return nodes;
    }

    private async processDirectory(
        fullPath: string,
        name: string,
        nodes: TreeNode[],
        depth: number
    ): Promise<void> {
        try {
            const children = await this.buildDirectoryTree(fullPath, depth);
            if (children.length > 0) {
                nodes.push({name, type: "directory", children});
            }
        } catch (err) {
            this.logWarn(`跳过目录 ${name}: ${this.getErrorMessage(err)}`);
        }
    }

    private async uploadBatchFiles(filePaths: string[], nodes: TreeNode[]): Promise<void> {
        if (filePaths.length === 0) return;

        const urlMap = await this.uploadFilesInBatches(filePaths);

        for (const filePath of filePaths) {
            const name = getFileName(filePath);
            const url = urlMap.get(name);
            if (url) {
                nodes.push({name, type: "file", url});
            }
        }
    }

    private async uploadFilesInBatches(filePaths: string[]): Promise<Map<string, string>> {
        const allResults = new Map<string, string>();
        const batches: string[][] = [];

        // 将文件分批
        for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
            batches.push(filePaths.slice(i, i + BATCH_SIZE));
        }

        // 串行上传每批
        for (let i = 0; i < batches.length; i++) {
            const batchResults = await this.uploadSingleBatch(batches[i], i + 1);
            batchResults.forEach((url, name) => allResults.set(name, url));
        }

        return allResults;
    }

    private async uploadSingleBatch(batch: string[], batchNumber: number): Promise<Map<string, string>> {
        const formData = await this.createFormDataFromPaths(batch);
        return this.sendUploadRequest(formData, batchNumber);
    }

    private async createFormDataFromPaths(filePaths: string[]): Promise<FormData> {
        const formData = new FormData();
        formData.append("assetsDirPath", ASSETS_DIR);

        // 并发读取所有文件
        const fileReadPromises = filePaths.map(async (filePath) => {
            try {
                const buffer = await fs.promises.readFile(filePath);
                const name = getFileName(filePath);
                return {file: new File([buffer], name), success: true};
            } catch {
                this.logWarn(`读取文件失败 ${filePath}`);
                return {file: null, success: false};
            }
        });

        const results = await Promise.all(fileReadPromises);

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
                throw new Error(result.msg || "上传失败");
            }

            return this.parseUploadResponse(result.data?.succMap || {});

        } catch (err) {
            this.logError(`批量上传失败 (批次 ${batchNumber})`, err);
            throw err;
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

    private countFiles(tree: TreeNode[]): number {
        let count = 0;
        const queue = [...tree];

        while (queue.length > 0) {
            const node = queue.shift()!;
            if (node.type === "file") {
                count++;
            } else if (node.children) {
                queue.push(...node.children);
            }
        }

        return count;
    }

    private generateTreeMarkdown(tree: TreeNode[], rootName: string, indent = 0): string {
        const lines: string[] = [];

        if (indent === 0) {
            lines.push(`- 📁 **${rootName}**`);
        }

        for (const node of tree) {
            lines.push(...this.renderNode(node, indent));
        }

        return lines.join("\n");
    }

    private renderNode(node: TreeNode, indent: number): string[] {
        const prefix = "  ".repeat(indent + 1) + "- ";

        if (node.type === "directory") {
            const lines = [`${prefix}📁 **${node.name}**`];
            if (node.children?.length) {
                lines.push(this.generateTreeMarkdown(node.children, "", indent + 1));
            }
            return lines;
        }

        if (node.type === "symlink") {
            // 符号链接，生成 markdown 但不上传
            const target = node.linkTarget || "未知目标";
            return [`${prefix}🔗 ${node.name} → \`${target}\``];
        }

        const link = node.url ? `[${node.name}](${node.url})` : `\`${node.name}\``;
        return [`${prefix}${link}`];
    }

    private async insertToEditor(markdown: string, blockId: string): Promise<void> {
        try {
            await fetchSyncPost("/api/block/insertBlock", {
                dataType: "markdown",
                data: markdown,
                previousID: blockId,
            });
        } catch (err) {
            this.logError("插入内容失败", err);
            throw new Error("插入内容失败");
        }
    }

    private getErrorMessage(err: unknown): string {
        if (err instanceof WorkspacePathError) return err.message;
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
        this.eventBus.off("open-menu-link", this.handleOpenMenuLink);
        showMessage(`[${this.name}]: 插件已卸载`);
        clearCache();
    }
}
