# Local Folder Uploader

[简体中文](./README_zh_CN.md)

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

1. **Create a file:// link in SiYuan Note**

   Enter in the editor:
   ```markdown
   file:///C:/Users/YourName/Documents/MyFolder
   ```

2. **Right-click on the link**

   Right-click on the link and select **「Upload local resource: [folder name]」**

3. **Wait for upload to complete**

   - The plugin will first scan all files in the folder
   - Then batch upload files to SiYuan assets directory
   - Finally insert directory tree Markdown below the current block

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
| Docker | ✅ |
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
- Repository: https://github.com/foxer/siyuan-folder-upload
