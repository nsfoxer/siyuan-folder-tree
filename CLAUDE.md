# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个基于 **Vite + Svelte 4** 的思源笔记插件示例项目。使用符号链接（symlink）模式进行开发，而非将项目复制到插件目录。

## 常用命令

### 开发流程
```bash
# 安装依赖
pnpm i

# 创建符号链接（将 dev 目录链接到思源插件目录）
pnpm run make-link

# Windows 下创建符号链接（需要管理员权限）
pnpm run make-link-win

# 开发模式：监听文件变化，实时编译到 dev 目录
pnpm run dev

# 生产构建：编译到 dist 目录并生成 package.zip
pnpm run build

# 构建并生成安装包
pnpm run make-install

# 更新版本号
pnpm run update-version
```

### 配置符号链接目标目录
有三种方式配置 `make-link` 的目标目录（思源工作空间/data/plugins）：
1. 直接运行命令，脚本会自动检测思源工作空间并提示选择
2. 编辑 `scripts/make_dev_link.js`，修改 `targetDir` 变量
3. 设置环境变量 `SIYUAN_PLUGIN_DIR`

## 代码架构

### 核心入口
- `src/index.ts` - 插件主类，继承自 `Plugin` 基类，实现生命周期方法：
  - `onload()` - 插件加载时初始化
  - `onLayoutReady()` - 布局就绪后添加 UI 元素
  - `onunload()` - 插件卸载时清理

### 插件功能示例
插件演示了思源笔记的各种 API 使用：
- **自定义标签页（Tab）** - 通过 `addTab()` 注册
- **自定义停靠面板（Dock）** - 通过 `addDock()` 注册
- **命令快捷键** - 通过 `addCommand()` 注册
- **顶部栏图标** - 通过 `addTopBar()` 添加
- **状态栏图标** - 通过 `addStatusBar()` 添加
- **右键菜单** - 通过 `eventBus` 订阅事件
- **斜杠命令** - 通过 `protyleSlash` 配置
- **设置面板** - 使用 `SettingUtils` 工具类

### 工具库（src/libs/）
- `setting-utils.ts` - 设置面板工具类，封装了思源的 Setting API
- `dialog.ts` - 对话框工具，封装 Svelte 组件对话框
- `components/` - UI 组件库
- `const.ts` - 常量定义
- `promise-pool.ts` - Promise 并发控制

### 构建配置
- `vite.config.ts` - Vite 构建配置：
  - 开发模式输出到 `dev/`，生产模式输出到 `dist/`
  - 使用 `@` 别名指向 `src` 目录
  - 外部依赖：`siyuan`、`process`
  - 自定义 YAML 国际化插件（`yaml-plugin.js`）
- `svelte.config.js` - Svelte 编译配置
- `tsconfig.json` - TypeScript 配置，ESNext 模块

## 国际化

插件支持多语言：
- `public/i18n/` - 存放语言文件（支持 YAML 和 JSON 格式）
- 构建时自动将 YAML 转换为 JSON
- 在代码中使用 `this.i18n.key` 获取文本
- 在 `plugin.json` 中通过 `displayName`、`description`、`readme` 字段配置多语言元信息

## 开发规范

### 重要：文件读写规范
**严禁直接使用 `fs` 或其他 Node.js/Electron API 读写思源 data 目录下的文件**，这可能导致数据同步时分块丢失。必须通过思源内核 API 实现，例如 `/api/file/getFile`。

### Daily Note 属性规范
手动创建日记文档时，需要为文档添加 `custom-dailynote-yyyymmdd` 属性。如果使用 `/api/filetree/createDailyNote` 创建，系统会自动添加该属性。

## 插件元数据（plugin.json）

- `name` - 插件名称，必须与库名一致且全局唯一
- `minAppVersion` - 支持的最低思源版本
- `backends` - 后端支持：`windows`、`linux`、`darwin`、`docker`、`android`、`ios`、`harmony`
- `frontends` - 前端支持：`desktop`、`mobile`、`browser-desktop`、`browser-mobile`、`desktop-window`
- `keywords` - 搜索关键字，用于集市搜索

## TypeScript 配置注意

项目当前 `strict: false`，类型检查较为宽松。路径别名 `@/*` 指向 `src/*`。

## 发布流程

1. 运行 `pnpm run build` 生成 `package.zip`
2. 在 GitHub 创建 Release，Tag 格式为 `v*`
3. 上传 `package.zip` 作为附件
4. 首次发布需提交 PR 到 [siyuan-note/bazaar](https://github.com/siyuan-note/bazaar) 添加插件索引