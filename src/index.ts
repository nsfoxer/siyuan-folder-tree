import {Plugin, showMessage, fetchSyncPost, IMenuBaseDetail} from "siyuan";

// 国际化接口定义
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
        tooManyFiles: string;
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

const BATCH_SIZE = 10;                      // 每批上传的文件数量
const ASSETS_DIR = "/assets/";                // 思源资源目录路径
const MAX_DEPTH = 9;                          // 最大目录深度限制
const MAX_FILE_SIZE = 100 * 1024 * 1024;     // 单个文件大小限制（100MB）
const MAX_FILES = 1000;                       // 最大文件数量限制

// 通过 window.require 获取 Node.js 模块（思源插件环境限制）
const fs = window.require('fs');
const path = window.require('path');

// 常量定义
const FILE_PROTOCOL = "file://";
const HREF_ATTR = "data-href";
const BLOCK_ID_ATTR = "data-node-id";
const HIDDEN_DIRS = new Set(['node_modules', '.git', '.vscode', '.idea']);

// 目录树节点接口
interface TreeNode {
    name: string;                              // 文件/目录名
    type: "file" | "directory" | "symlink";    // 节点类型
    filePath?: string;                         // 文件完整路径（遍历时填充）
    url?: string;                              // 上传后的 URL（上传后填充）
    children?: TreeNode[];                     // 子节点（目录类型）
    linkTarget?: string;                       // 符号链接目标路径
}

type FilterFn = (name: string) => boolean;

// 默认文件过滤器：跳过隐藏文件和系统目录
const defaultFilter: FilterFn = (name) => {
    if (name.startsWith('.') || name.startsWith('~')) return false;
    return !HIDDEN_DIRS.has(name);
};

// 文件名缓存：避免重复计算 basename（性能优化）
const fileNameCache = new Map<string, string>();

/**
 * 获取文件名（带缓存）
 * @param filePath 文件完整路径
 * @returns 文件名
 */
function getFileName(filePath: string): string {
    let name = fileNameCache.get(filePath);
    if (!name) {
        name = path.basename(filePath);
        fileNameCache.set(filePath, name);
    }
    return name;
}

/** 清理缓存（操作完成后调用，释放内存） */
function clearCache() {
    fileNameCache.clear();
}

// 思源笔记插件主类
export default class NFPlugin extends Plugin{
    // @ts-ignore - i18n 由思源运行时注入
    declare i18n: II18n;

    private siyuanWorkspaceDir: string | null = null;        // 思源工作目录原始路径
    private normalizedWorkspaceDir: string | null = null;    // 规范化后的工作目录路径（缓存）
    private uploadAbortController: AbortController | null = null;  // 用于取消上传
    private failedFiles: string[] = [];                       // 记录失败的文件列表

    /** 插件加载入口 */
    async onload() {
        this.eventBus.on("open-menu-link", this.handleOpenMenuLink.bind(this));
        this.initSiyuanWorkspaceDir();
    }

    /** 初始化思源工作目录 */
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

    /**
     * 检查路径是否在思源工作目录下
     * @param filePath 待检查的文件路径
     * @returns 是否在工作目录内
     */
    private isInSiyuanWorkspace(filePath: string): boolean {
        if (!this.normalizedWorkspaceDir) return false;
        const normalizedPath = path.normalize(filePath);
        return normalizedPath.startsWith(this.normalizedWorkspaceDir + path.sep);
    }

    /**
     * 检查路径是否为思源工作目录的祖先目录（防止上传父目录或工作目录本身）
     * @param filePath 待检查的文件路径
     * @returns 是否为工作目录的祖先
     */
    private isAncestorOfSiyuanWorkspace(filePath: string): boolean {
        if (!this.normalizedWorkspaceDir) return false;
        const normalizedPath = path.normalize(filePath);
        return this.normalizedWorkspaceDir.startsWith(normalizedPath + path.sep) ||
               normalizedPath === this.normalizedWorkspaceDir;
    }

    /**
     * 安全验证：检查路径是否包含路径遍历攻击 (../)
     * @param filePath 待检查的文件路径
     * @returns 是否包含路径遍历字符
     */
    private hasPathTraversal(filePath: string): boolean {
        return filePath.includes('..');
    }

    /**
     * 综合路径验证（安全检查）
     * @param filePath 待验证的文件路径
     * @returns 验证结果
     */
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

    /** 处理链接菜单打开事件（思源事件监听） */
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

    /**
     * 验证文件路径并添加上传菜单项
     * @param filePath 文件路径
     * @param element DOM 元素
     * @param menu 菜单对象
     * @returns 是否验证通过
     */
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

    /**
     * 向上遍历 DOM 树查找块 ID
     * @param element 起始元素
     * @returns 块 ID 或 null
     */
    private findBlockId(element: HTMLElement): string | null {
        let current: HTMLElement | null = element;
        while (current) {
            const blockId = current.getAttribute(BLOCK_ID_ATTR);
            if (blockId) return blockId;
            current = current.parentElement;
        }
        return null;
    }

    /**
     * 上传文件夹并插入到编辑器（核心流程）
     * 流程：1.扫描目录 2.批量上传 3.回填URL 4.插入markdown
     * @param dirPath 目录路径
     * @param blockId 目标块 ID
     */
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
            if (filePaths.length >= MAX_FILES) {
                showMessage(`[${this.name}]: ${this.i18n.error.tooManyFiles
                    .replace('${maxFiles}', String(MAX_FILES))
                }`);
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

    /** 检查路径是否为目录 */
    private isDirectory(dirPath: string): boolean {
        try {
            return fs.statSync(dirPath).isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * 构建目录树（并发处理子目录）
     * @param dirPath 目录路径
     * @param currentDepth 当前深度
     * @param fileCountRef 文件计数引用（共享计数器）
     * @returns 树结构和文件路径列表
     */
    private async buildDirectoryTree(
        dirPath: string,
        currentDepth: number,
        fileCountRef: {count: number} = {count: 0}
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
                // 检查文件数量限制（在添加文件之前）
                if (fileCountRef.count >= MAX_FILES) {
                   continue;
                }
                if (entry.isFile()) {
                    // P0 优化：普通文件使用同步 stat，无需异步 lstat（entry.isFile() 已确认类型）
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
                    fileCountRef.count++;
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

        // 并发处理子目录（最多 3 个 worker），平衡性能与资源占用
        const MAX_CONCURRENT_SUBDIRS = 3;
        let index = 0;

        const processNext = async (): Promise<void> => {
            while (index < subDirs.length) {
                if (this.uploadAbortController?.signal.aborted) {
                    break;
                }
                const subDir = subDirs[index++];
                const result = await this.buildDirectoryTree(subDir.path, currentDepth + 1, fileCountRef);
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

    /**
     * 将上传后的 URL 回填到树结构中
     * @param tree 树结构
     * @param urlMap 文件路径到 URL 的映射
     */
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

    /**
     * 批量上传文件（分批处理，每批 BATCH_SIZE 个文件）
     * @param filePaths 文件路径列表
     * @returns 文件路径到 URL 的映射
     */
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

    /**
     * 检测批次内同名文件，生成重命名映射
     * @param filePaths 文件路径列表
     * @returns 文件路径到重命名后文件名的映射
     */
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

    /**
     * 上传单个批次
     * @param batch 批次文件路径列表
     * @param renameMap 重命名映射
     * @param batchNumber 批次编号
     * @returns 文件名到 URL 的映射
     */
    private async uploadSingleBatch(batch: string[], renameMap: Map<string, string>, batchNumber: number): Promise<Map<string, string>> {
        const formData = await this.createFormDataFromPaths(batch, renameMap);
        return this.sendUploadRequest(formData, batchNumber);
    }

    /**
     * 从文件路径创建 FormData（并发读取文件）
     * @param filePaths 文件路径列表
     * @param renameMap 重命名映射
     * @returns FormData 对象
     */
    private async createFormDataFromPaths(filePaths: string[], renameMap: Map<string, string>): Promise<FormData> {
        const formData = new FormData();
        formData.append("assetsDirPath", ASSETS_DIR);

        // 并发读取文件（最多 5 个），降低内存占用峰值
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

    /**
     * 发送上传请求到思源 API
     * @param formData FormData 对象
     * @param batchNumber 批次编号
     * @returns 文件名到 URL 的映射
     */
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

    /** 解析思源 API 响应 */
    private parseUploadResponse(succMap: Record<string, string>): Map<string, string> {
        const results = new Map<string, string>();
        for (const [name, url] of Object.entries(succMap)) {
            results.set(name, url);
        }
        return results;
    }

    /**
     * 将目录树插入到编辑器
     * @param tree 目录树
     * @param dirPath 原始目录路径
     * @param blockId 目标块 ID
     */
    private async insertMarkdown(tree: TreeNode[], dirPath: string, blockId: string): Promise<void> {
        const dirName = getFileName(dirPath);
        const markdown = this.generateTreeMarkdown(tree, dirName);
        await this.insertToEditor(markdown, blockId);
    }

    /**
     * 生成目录树的 Markdown 文本
     * @param tree 目录树
     * @param rootName 根目录名称
     * @param indent 缩进层级
     * @returns Markdown 文本
     */
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

    /**
     * 渲染单个节点到 Markdown（优化：直接传入 lines 数组引用）
     * @param node 树节点
     * @param indent 缩进层级
     * @param lines Markdown 行数组
     */
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

    /** 调用思源 API 插入内容到编辑器 */
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

    /** 获取错误信息的字符串表示 */
    private getErrorMessage(err: unknown): string {
        if (err instanceof Error) return err.message;
        return String(err);
    }

    /** 记录错误日志 */
    private logError(message: string, err?: unknown): void {
        const errorDetails = err ? `: ${this.getErrorMessage(err)}` : "";
        console.error(`[${this.name}] ${message}${errorDetails}`);
    }

    /** 记录警告日志 */
    private logWarn(message: string): void {
        console.warn(`[${this.name}] ${message}`);
    }

    /** 插件卸载入口 */
    async onunload() {
        this.cancelUpload();

        this.eventBus.off("open-menu-link", this.handleOpenMenuLink);
        clearCache();
    }

    /**
     * 取消当前上传（公开方法，可供外部调用）
     * 通过 AbortController 中断所有异步操作
     */
    public cancelUpload(): void {
        if (this.uploadAbortController) {
            this.uploadAbortController.abort();
            this.uploadAbortController = null;
            showMessage(`[${this.name}]: ${this.i18n.uploadCanceled}`);
        }
    }
}
