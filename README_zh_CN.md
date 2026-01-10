# 本地文件夹上传

[English](https://github.com/nsfoxer/siyuan-folder-tree/blob/main/README.md)

> 思源笔记插件 - 右键点击 file:// 链接上传本地文件夹到思源笔记，自动生成目录树 Markdown

## ✨ 功能特性

- 📁 **一键上传文件夹** - 右键点击文档中的 `file://` 链接即可上传整个文件夹
- 🌳 **自动生成目录树** - 上传完成后自动生成带图标的目录树 Markdown
- 🔒 **安全保护** - 自动检测并阻止上传思源工作目录，防止数据损坏
- ⚡ **批量上传** - 支持批量上传文件，自动处理同名文件冲突
- 📊 **进度显示** - 实时显示扫描和上传进度
- 🛡️ **多重限制** - 目录深度限制、文件大小限制、路径遍历攻击防护
- 🌍 **多语言支持** - 支持 11 种语言界面

## 📖 使用方法

### 基本使用

1. **在思源笔记中拖入文件夹**

  ![拖入文件夹](https://nsfoxer-oss.oss-cn-beijing.aliyuncs.com/img/6c4303069fc3fd4709a45b1d19747e2202bd975ccd057e883ab1da580e6c1a38.webp)

2. **右键点击链接**

   在链接上点击右键，选择 **「上传本地资源: [文件夹名]」**
   ![右键点击](https://nsfoxer-oss.oss-cn-beijing.aliyuncs.com/img/c10837759e69b095c8f687153954b51f41c648bf99ffe8c5483f6062b837b9c0.webp)

3. **等待上传完成**

   - 插件会先扫描文件夹中的所有文件
   - 然后批量上传文件到思源资源目录
   - 最后在当前块下方插入目录树 Markdown
   
   ![生成文件树](https://nsfoxer-oss.oss-cn-beijing.aliyuncs.com/img/8d3fd0dbb786d68cf5f420a20bbc1a86b5fa2e53eff47f8b06de6daac741b706.webp)

### 生成的目录树示例

```markdown
- 📁 **MyFolder**
  - 📁 **images**
    - 📄 [photo.jpg](/assets/photo.jpg)
  - 📁 **documents**
    - 📄 [report.pdf](/assets/report.pdf)
  - 📄 [readme.txt](/assets/readme.txt)
```

## 🔒 安全说明

### 自动保护的路径

插件会自动阻止上传以下路径：

- ❌ 思源工作目录及其子目录
- ❌ 思源工作目录的祖先目录（防止上传父目录）
- ❌ 包含 `..` 的路径（路径遍历攻击防护）

### 跳过的目录

自动跳过以下常见系统目录：

- `node_modules`
- `.git`
- `.vscode`
- `.idea`

### 限制说明

| 限制项 | 限制值 | 说明 |
|--------|--------|------|
| 最大目录深度 | 9 层 | 防止过深的目录结构 |
| 单文件大小 | 100MB | 超过限制的文件会被跳过 |
| 符号链接 | 自动跳过 | 不跟随符号链接 |

## 🌍 支持的语言

- 🇺🇸 English (en_US)
- 🇨🇳 简体中文 (zh_CN)
- 🇩🇪 Deutsch (de_DE)
- 🇪🇸 Español (es_ES)
- 🇫🇷 Français (fr_FR)
- 🇮🇱 עברית (he_IL)
- 🇮🇹 Italiano (it_IT)
- 🇯🇵 日本語 (ja_JP)
- 🇵🇱 Polski (pl_PL)
- 🇷🇺 Русский (ru_RU)
- 🇹🇼 繁體中文 (zh_CHT)

## ⚙️ 系统要求

### 平台支持

| 后端 | 支持情况 |
|------|----------|
| Windows | ✅ |
| Linux | ✅ |
| macOS | ✅ |
| Docker | ❌ |
| 移动端 | ❌ (依赖 Node.js fs 模块) |

| 前端 | 支持情况 |
|------|----------|
| 桌面端 | ✅ |
| 浏览器端 | ❌ (无法访问本地文件系统) |

### 思源笔记版本

最低支持版本：**v3.2.1**

## 📦 安装

### 从思源集市安装

1. 打开思源笔记
2. 进入 **「设置」** → **「集市」** → **「插件」**
3. 搜索 **「本地文件夹上传」**
4. 点击安装并启用

### 手动安装

1. 下载最新版本的 `package.zip`
2. 解压到思源工作空间的 `data/plugins/siyuan-folder-upload/` 目录
3. 重启思源笔记
4. 在集市中启用插件

## 🔧 开发

```bash
# 安装依赖
pnpm install

# 创建符号链接（开发模式）
pnpm run make-link

# 监听文件变化，实时编译
pnpm run dev

# 构建生产版本
pnpm run build

# 打包发布
pnpm run make-install
```

## 📄 开源协议

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📮 联系方式

- 作者：nsfoxer
- 仓库：https://github.com/nsfoxer/siyuan-folder-tree
