# Local Folder Uploader

[简体中文](https://github.com/nsfoxer/siyuan-folder-tree/blob/main/README_zh_CN.md)

> SiYuan Note Plugin - Right-click on file:// links to upload local folders to SiYuan and automatically generate directory tree Markdown

## ✨ Features

- 📁 **One-Click Folder Upload** - Simply right-click on `file://` links in your documents to upload entire folders
- 🌳 **Auto-Generate Directory Tree** - Automatically generates iconized directory tree Markdown after upload
- 🔒 **Security Protection** - Automatically detects and blocks uploads from SiYuan workspace to prevent data corruption
- ⚡ **Batch Upload** - Supports batch file uploads with automatic handling of duplicate filenames
- 📊 **Progress Display** - Real-time display of scanning and upload progress
- 🛡️ **Multiple Limits** - Directory depth limit, file size limit, path traversal attack protection
- 🌍 **Multi-Language Support** - Interface available in 11 languages

## 📖 Usage

### Basic Usage

1. **Drag a folder into SiYuan Note**

   ![Drag folder into SiYuan](https://nsfoxer-oss.oss-cn-beijing.aliyuncs.com/img/6c4303069fc3fd4709a45b1d19747e2202bd975ccd057e883ab1da580e6c1a38.webp)

2. **Right-click on the link**

   Right-click on the link and select **「Upload local resource: [folder name]」**
   ![Right-click on link](https://nsfoxer-oss.oss-cn-beijing.aliyuncs.com/img/c10837759e69b095c8f687153954b51f41c648bf99ffe8c5483f6062b837b9c0.webp)

3. **Wait for upload to complete**

   - The plugin will first scan all files in the folder
   - Then batch upload files to SiYuan assets directory
   - Finally insert directory tree Markdown below the current block

   ![Generated file tree](https://nsfoxer-oss.oss-cn-beijing.aliyuncs.com/img/8d3fd0dbb786d68cf5f420a20bbc1a86b5fa2e53eff47f8b06de6daac741b706.webp)

### Generated Directory Tree Example

```markdown
- 📁 **MyFolder**
  - 📁 **images**
    - 📄 [photo.jpg](/assets/photo.jpg)
  - 📁 **documents**
    - 📄 [report.pdf](/assets/report.pdf)
  - 📄 [readme.txt](/assets/readme.txt)
```

## 🔒 Security Notes

### Protected Paths

The plugin automatically blocks uploads from the following paths:

- ❌ SiYuan workspace directory and its subdirectories
- ❌ Ancestor directories of SiYuan workspace (prevents uploading parent directories)
- ❌ Paths containing `..` (path traversal attack protection)

### Skipped Directories

Automatically skips the following common system directories:

- `node_modules`
- `.git`
- `.vscode`
- `.idea`

### Limitations

| Limit | Value | Description |
|-------|-------|-------------|
| Max Directory Depth | 9 levels | Prevents excessively deep directory structures |
| Max File Size | 100MB | Files exceeding limit will be skipped |
| Symbolic Links | Auto Skip | Does not follow symbolic links |

## 🌍 Supported Languages

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

## ⚙️ System Requirements

### Platform Support

| Backend | Status |
|---------|--------|
| Windows | ✅ |
| Linux | ✅ |
| macOS | ✅ |
| Docker | ❌ |
| Mobile | ❌ (Requires Node.js fs module) |

| Frontend | Status |
|----------|--------|
| Desktop | ✅ |
| Browser | ❌ (Cannot access local file system) |

### SiYuan Note Version

Minimum supported version: **v3.2.1**

## 📦 Installation

### Install from SiYuan Bazaar

1. Open SiYuan Note
2. Go to **「Settings」** → **「Bazaar」** → **「Plugins」**
3. Search for **「Local Folder Uploader」**
4. Click install and enable

### Manual Installation

1. Download the latest `package.zip`
2. Extract to SiYuan workspace's `data/plugins/siyuan-folder-upload/` directory
3. Restart SiYuan Note
4. Enable the plugin in Bazaar

## 🔧 Development

```bash
# Install dependencies
pnpm install

# Create symbolic link (development mode)
pnpm run make-link

# Watch for file changes and compile in real-time
pnpm run dev

# Build production version
pnpm run build

# Package for release
pnpm run make-install
```

## 📄 License

MIT License

## 🤝 Contributing

Issues and Pull Requests are welcome!

## 📮 Contact

- Author: nsfoxer
- Repository: https://github.com/nsfoxer/siyuan-folder-tree
