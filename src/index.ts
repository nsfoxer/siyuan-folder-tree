import {Plugin, showMessage, fetchSyncPost, IMenuBaseDetail} from "siyuan";

const BATCH_SIZE = 10;
const ASSETS_DIR = "/assets/";
const MAX_DEPTH = 7; // 最大目录深度
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
    url?: string;
    children?: TreeNode[];
    linkTarget?: string;
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

// 深度超限错误类
class DepthExceededError extends Error {
    constructor(depth: number) {
        super(`目录深度超过限制 (${depth}/${MAX_DEPTH})`);
        this.name = 'DepthExceededError';
    }
}

export default class NFPlugin extends Plugin{

    private siyuanWorkspaceDir: string | null = null;
    private normalizedWorkspaceDir: string | null = null; // 缓存规范化的工作区路径
    private uploadAbortController: AbortController | null = null; // 用于取消上传
    private failedFiles: string[] = []; // 记录失败的文件
    private totalFileCount: number = 0; // 在构建树时同步统计文件数

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
                // 预先规范化工作区路径，避免重复计算 (P1 修复)
                this.normalizedWorkspaceDir = path.normalize(this.siyuanWorkspaceDir);
            }
        } catch (err) {
            console.warn("初始化思源工作目录失败:", err);
        }
    }

    // 检查路径是否在思源工作目录下 (P1 修复: 缓存规范化路径)
    private isInSiyuanWorkspace(filePath: string): boolean {
        if (!this.normalizedWorkspaceDir) return false;

        const normalizedPath = path.normalize(filePath);
        return normalizedPath.startsWith(this.normalizedWorkspaceDir + path.sep) ||
               normalizedPath === this.normalizedWorkspaceDir;
    }

    // 安全验证：检查路径是否包含遍历攻击 (../)
    private hasPathTraversal(filePath: string): boolean {
        const normalized = path.normalize(filePath);
        // 检查是否包含 ".." 且不在原始路径的合法位置
        const parts = normalized.split(path.sep);
        for (const part of parts) {
            if (part === '..') {
                return true;
            }
        }
        return false;
    }

    // 验证路径是否安全
    private validatePath(filePath: string): {valid: boolean, error?: string} {
        // 检查路径遍历攻击
        if (this.hasPathTraversal(filePath)) {
            return {valid: false, error: '路径包含非法字符 (..)'};
        }

        // 检查是否为空
        if (!filePath || filePath.trim() === '') {
            return {valid: false, error: '路径为空'};
        }

        // 检查是否在思源工作目录下
        if (this.isInSiyuanWorkspace(filePath)) {
            return {valid: false, error: '不允许上传思源工作目录下的文件'};
        }

        return {valid: true};
    }

    // 安全检查符号链接目标
    private isSymlinkSafe(target: string, sourceDir: string): boolean {
        try {
            const resolvedTarget = path.resolve(sourceDir, target);
            const normalizedTarget = path.normalize(resolvedTarget);

            // 不允许指向思源工作目录
            if (this.isInSiyuanWorkspace(normalizedTarget)) {
                return false;
            }

            // 不允许指向系统敏感目录
            const sensitiveDirs = ['/etc', '/root', '/home', 'C:\\Windows', 'C:\\ProgramData'];
            for (const sensitive of sensitiveDirs) {
                if (normalizedTarget.startsWith(sensitive)) {
                    return false;
                }
            }

            return true;
        } catch {
            return false;
        }
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

        // 安全验证：检查路径是否安全
        const validation = this.validatePath(filePath);
        if (!validation.valid) {
            showMessage(`[${this.name}]: ${validation.error}`);
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
        this.failedFiles = []; // 重置失败文件列表
        this.totalFileCount = 0; // 重置文件计数
        this.uploadAbortController = new AbortController(); // 创建新的 AbortController

        try {
            // 安全验证
            const validation = this.validatePath(dirPath);
            if (!validation.valid) {
                showMessage(`[${this.name}]: ${validation.error}`);
                return;
            }

            if (!this.isDirectory(dirPath)) {
                showMessage(`[${this.name}]: 仅支持文件夹上传`);
                return;
            }

            showMessage(`[${this.name}]: 正在扫描文件夹...`);
            const tree = await this.buildDirectoryTree(dirPath, 0, new Set());

            // 使用同步统计的文件数
            const totalFiles = this.totalFileCount;

            if (totalFiles === 0) {
                showMessage(`[${this.name}]: 文件夹为空或无可上传文件`);
                return;
            }

            showMessage(`[${this.name}]: 正在上传 ${totalFiles} 个文件...`);
            await this.insertMarkdown(tree, dirPath, blockId);

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

            // 显示上传结果，包括失败文件信息
            if (this.failedFiles.length > 0) {
                showMessage(`[${this.name}]: 已上传 ${totalFiles - this.failedFiles.length}/${totalFiles} 个文件，失败 ${this.failedFiles.length} 个 (耗时 ${elapsed}s)`);
            } else {
                showMessage(`[${this.name}]: 已上传 ${totalFiles} 个文件 (耗时 ${elapsed}s)`);
            }

        } catch (err) {
            if (err instanceof DepthExceededError) {
                showMessage(`[${this.name}]: ${err.message}`);
            } else {
                this.logError("处理文件夹失败", err);
                const errorMsg = this.getErrorMessage(err);
                showMessage(`[${this.name}]: ${errorMsg}`);
            }
        } finally {
            clearCache(); // 确保清理缓存
            this.uploadAbortController = null; // 清理 AbortController
        }
    }

    private isDirectory(dirPath: string): boolean {
        try {
            return fs.statSync(dirPath).isDirectory();
        } catch {
            return false;
        }
    }

    // 合并深度检查和树构建，只遍历一次目录树
    private async buildDirectoryTree(
        dirPath: string,
        currentDepth: number,
        visitedInodes: Set<string>
    ): Promise<TreeNode[]> {
        // 检查深度限制
        if (currentDepth >= MAX_DEPTH) {
            throw new DepthExceededError(currentDepth + 1);
        }

        // 检查取消信号 - 本地处理，直接返回空节点
        if (this.uploadAbortController?.signal.aborted) {
            return [];
        }

        const entries = await fs.promises.readdir(dirPath, {withFileTypes: true});
        const nodes: TreeNode[] = [];
        const filePaths: string[] = [];
        const subDirs: Array<{name: string, path: string}> = [];

        // 分类收集文件和目录（P0优化：普通文件跳过冗余lstat）
        for (const entry of entries) {
            if (!defaultFilter(entry.name)) continue;

            const fullPath = path.join(dirPath, entry.name);

            try {
                if (entry.isFile()) {
                    // P0: 普通文件使用同步 stat，无需异步 lstat（entry.isFile() 已确认类型）
                    const size = fs.statSync(fullPath).size;
                    if (size > MAX_FILE_SIZE) {
                        this.logWarn(`文件过大 (${(size / 1024 / 1024).toFixed(1)}MB)，已跳过: ${entry.name}`);
                        this.failedFiles.push(fullPath);
                        continue;
                    }
                    this.totalFileCount++; // P0: 遍历时统计文件数
                    filePaths.push(fullPath);
                } else if (entry.isSymbolicLink()) {
                    // P0: 符号链接需要 lstat 获取 inode 进行循环检测
                    const lstat = await fs.promises.lstat(fullPath);
                    const inodeId = `${lstat.dev}-${lstat.ino}`;

                    if (visitedInodes.has(inodeId)) {
                        this.logWarn(`检测到循环符号链接，已跳过: ${entry.name}`);
                        continue;
                    }

                    const target = await fs.promises.readlink(fullPath);

                    if (!this.isSymlinkSafe(target, dirPath)) {
                        this.logWarn(`符号链接指向不安全位置，已跳过: ${entry.name}`);
                        nodes.push({name: entry.name, type: "symlink", linkTarget: target});
                        continue;
                    }

                    visitedInodes.add(inodeId);
                    nodes.push({name: entry.name, type: "symlink", linkTarget: target});
                } else if (entry.isDirectory()) {
                    // P0: 目录需要 lstat 获取 inode 进行循环检测
                    const lstat = await fs.promises.lstat(fullPath);
                    const inodeId = `${lstat.dev}-${lstat.ino}`;

                    if (visitedInodes.has(inodeId)) {
                        this.logWarn(`检测到循环目录引用，已跳过: ${entry.name}`);
                        continue;
                    }

                    if (this.isInSiyuanWorkspace(fullPath)) {
                        this.logWarn(`跳过思源工作目录下的文件夹: ${entry.name}`);
                        continue;
                    }

                    visitedInodes.add(inodeId);
                    subDirs.push({name: entry.name, path: fullPath});
                }
            } catch (err) {
                this.failedFiles.push(fullPath);
                this.logWarn(`无法读取 ${entry.name}: ${this.getErrorMessage(err)}`);
            }
        }

        // 批量上传当前目录的文件
        await this.uploadBatchFiles(filePaths, nodes);

        // 使用受限并发处理子目录 (3个并发)
        const MAX_CONCURRENT_SUBDIRS = 3;
        let index = 0;

        // 使用箭头函数保持 this 绑定
        const processNext = async (): Promise<void> => {
            while (index < subDirs.length) {
                // 检查取消信号
                if (this.uploadAbortController?.signal.aborted) {
                    break;
                }
                const subDir = subDirs[index++];
                await this.processDirectory(subDir.path, subDir.name, nodes, currentDepth + 1, visitedInodes);
            }
        };

        // 启动并发任务
        const workers = Array(Math.min(MAX_CONCURRENT_SUBDIRS, subDirs.length))
            .fill(null)
            .map(() => processNext());

        await Promise.all(workers);

        return nodes;
    }

    private async processDirectory(
        fullPath: string,
        name: string,
        nodes: TreeNode[],
        depth: number,
        visitedInodes: Set<string>
    ): Promise<void> {
        try {
            const children = await this.buildDirectoryTree(fullPath, depth, visitedInodes);
            // 中等问题修复：空目录也显示
            nodes.push({name, type: "directory", children});
        } catch (err) {
            if (err instanceof DepthExceededError) {
                // 深度超限，添加提示节点
                nodes.push({
                    name,
                    type: "directory",
                    children: [{
                        name: "(深度超限，已跳过)",
                        type: "file"
                    }]
                });
            } else {
                this.logWarn(`跳过目录 ${name}: ${this.getErrorMessage(err)}`);
            }
        }
    }

    private async uploadBatchFiles(filePaths: string[], nodes: TreeNode[]): Promise<void> {
        if (filePaths.length === 0) return;

        const urlMap = await this.uploadFilesInBatches(filePaths);

        // 修复文件名冲突：使用 filePath 作为 key，而非 name
        for (const filePath of filePaths) {
            const name = getFileName(filePath);
            // 为同名文件生成唯一标识符
            const uniqueKey = this.generateFileKey(filePath);
            const url = urlMap.get(uniqueKey);

            if (url) {
                nodes.push({name, type: "file", url});
            } else {
                // 上传失败，记录到失败列表
                this.failedFiles.push(filePath);
            }
        }
    }

    // P0: 直接使用 filePath 作为唯一键（无需 MD5 哈希）
    private generateFileKey(filePath: string): string {
        return filePath;
    }

    private async uploadFilesInBatches(filePaths: string[]): Promise<Map<string, string>> {
        const allResults = new Map<string, string>();

        // 检测同名文件冲突，生成唯一文件名映射
        const nameCountMap = new Map<string, number>();
        const fileRenameMap = new Map<string, string>(); // filePath -> 上传时使用的文件名

        for (const filePath of filePaths) {
            const originalName = getFileName(filePath);
            const count = nameCountMap.get(originalName) || 0;
            nameCountMap.set(originalName, count + 1);

            if (count > 0) {
                const ext = path.extname(originalName);
                const baseName = path.basename(originalName, ext);
                const uniqueName = `${baseName}_${count}${ext}`;
                fileRenameMap.set(filePath, uniqueName);
            } else {
                fileRenameMap.set(filePath, originalName);
            }
        }

        // 将文件分批
        const batches: Array<{paths: string[], renameMap: Map<string, string>}> = [];
        for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
            const batchPaths = filePaths.slice(i, i + BATCH_SIZE);
            const batchRenameMap = new Map<string, string>();
            batchPaths.forEach(p => {
                const rename = fileRenameMap.get(p);
                if (rename) batchRenameMap.set(p, rename);
            });
            batches.push({paths: batchPaths, renameMap: batchRenameMap});
        }

        // 串行上传每批
        for (let i = 0; i < batches.length; i++) {
            // 检查取消信号
            if (this.uploadAbortController?.signal.aborted) {
                break;
            }

            const {paths: batchPaths, renameMap: batchRenameMap} = batches[i];
            const batchResults = await this.uploadSingleBatch(batchPaths, batchRenameMap, i + 1);

            // 使用实际上传的文件名查找 URL
            for (const filePath of batchPaths) {
                const uploadedName = batchRenameMap.get(filePath)!;
                const uniqueKey = this.generateFileKey(filePath);
                const url = batchResults.get(uploadedName);

                if (url) {
                    allResults.set(uniqueKey, url);
                } else {
                    // 上传失败
                    this.failedFiles.push(filePath);
                }
            }
        }

        return allResults;
    }

    private async uploadSingleBatch(batch: string[], renameMap: Map<string, string>, batchNumber: number): Promise<Map<string, string>> {
        const formData = await this.createFormDataFromPaths(batch, renameMap);
        return this.sendUploadRequest(formData, batchNumber);
    }

    private async createFormDataFromPaths(filePaths: string[], renameMap: Map<string, string>): Promise<FormData> {
        const formData = new FormData();
        formData.append("assetsDirPath", ASSETS_DIR);

        // 并发读取所有文件（限制并发数以降低内存占用）
        const MAX_CONCURRENT_READS = 5;
        const results: Array<{filePath: string, file: File | null, success: boolean}> = [];

        for (let i = 0; i < filePaths.length; i += MAX_CONCURRENT_READS) {
            const batch = filePaths.slice(i, i + MAX_CONCURRENT_READS);

            const batchPromises = batch.map(async (filePath) => {
                try {
                    // 检查取消信号
                    if (this.uploadAbortController?.signal.aborted) {
                        return {filePath, file: null, success: false};
                    }

                    const buffer = await fs.promises.readFile(filePath);
                    // 使用重命名后的文件名（如果有冲突）
                    const uploadName = renameMap.get(filePath) || getFileName(filePath);
                    return {filePath, file: new File([buffer], uploadName), success: true};
                } catch {
                    this.failedFiles.push(filePath);
                    this.logWarn(`读取文件失败 ${filePath}`);
                    return {filePath, file: null, success: false};
                }
            });

            results.push(...await Promise.all(batchPromises));
        }

        // 将成功读取的文件添加到 FormData
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
                this.logError(`批量上传失败 (批次 ${batchNumber}): ${result.msg || "上传失败"}`);
                return new Map(); // 本地处理错误，返回空 Map
            }

            return this.parseUploadResponse(result.data?.succMap || {});

        } catch (err) {
            this.logError(`批量上传失败 (批次 ${batchNumber})`, err);
            return new Map(); // 本地处理错误，返回空 Map
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

    // 优化: 直接传入 lines 数组引用，避免展开运算符创建临时数组
    private renderNode(node: TreeNode, indent: number, lines: string[]): void {
        const prefix = "  ".repeat(indent + 1) + "- ";

        if (node.type === "directory") {
            lines.push(`${prefix}📁 **${node.name}**`);
            if (node.children?.length) {
                lines.push(this.generateTreeMarkdown(node.children, "", indent + 1));
            }
        } else if (node.type === "symlink") {
            const target = node.linkTarget || "未知目标";
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
            this.logError("插入内容失败", err);
            // 本地处理错误，不再抛出异常
        }
    }

    private getErrorMessage(err: unknown): string {
        if (err instanceof WorkspacePathError) return err.message;
        if (err instanceof DepthExceededError) return err.message;
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
        // 取消正在进行的上传
        this.cancelUpload();

        this.eventBus.off("open-menu-link", this.handleOpenMenuLink);
        showMessage(`[${this.name}]: 插件已卸载`);
        clearCache();
    }

    // 公开方法：取消当前上传
    public cancelUpload(): void {
        if (this.uploadAbortController) {
            this.uploadAbortController.abort();
            this.uploadAbortController = null;
            showMessage(`[${this.name}]: 上传已取消`);
        }
    }
}
