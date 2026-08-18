# dsh-wallpaper-engine

[English](README.en.md) | 中文

DeepSeek Harness（`dsh`）的 Wallpaper Engine 面板、背景层和 Windows 桌面壳。

## 插件介绍

`dsh-wallpaper-engine` 是一个 DeepSeek Harness Web 插件，为 `dsh web` 增加“桌面与壁纸”设置面板和全屏背景层。插件通过标准 `dsh plugin add` 安装，网页版提供安全的本地壁纸预览；与 `desktop/` 桌面壳一起使用时，解锁完整的 Steam 小红车（Wallpaper Engine）壁纸导入、原生 Scene 运行和 Windows 桌面模式。

## 支持导入 Steam 小红车（Wallpaper Engine）壁纸

桌面壳会自动发现 Steam 上 Wallpaper Engine（小红车）的创意工坊订阅壁纸和本地项目，并在 设置 → **桌面与壁纸** 中展示。你还可以手动导入任意包含 `project.json` 的壁纸目录，或单个 `project.json` / 场景包（`.pkg` / `.pak`）。

支持的能力：

- 识别 Steam 创意工坊（App ID `431960`）与 `wallpaper_engine/projects/myprojects` 本地项目
- 壁纸卡片懒加载、搜索、导入/移除
- 图片、视频、Scene 预览设为聊天背景
- 不透明度 / 模糊 / 填充方式
- 选择持久化，刷新自动恢复
- 原生 Wallpaper Engine Scene 启停（通过桌面壳）
- M5 桌面模式：WorkerW 壁纸、桌面嵌入、桌面图标显示/隐藏

## 仓库结构

```
packages/dsh-wallpaper-engine/   dsh 可安装 Web 插件（dsh.bundle + dsh.client）
desktop/                         Windows Electron 桌面壳
```

插件单独安装即可在 设置 → **桌面与壁纸** 使用网页版安全预览；配合桌面壳才解锁完整的小红车壁纸导入和桌面模式。

## Windows 用户快速开始

不需要预装 Node.js 或 dsh。首次启动时，程序会检测 dsh 运行环境：缺失时弹出安装窗口，一键自动安装 Node.js（winget）和 DeepSeek Harness（npm），然后启动 `dsh web` 并继续运行。

1. 从 GitHub Releases 下载并解压最新 Windows 包，或克隆本仓库。
2. 运行：

```bat
start-dsh-desktop.bat
```

启动脚本优先使用 `desktop\release\DeepSeek Harness桌面版-win32-x64\DeepSeek Harness桌面版.exe`，没有打包版时回退到开发模式 Electron。

创建带 DSH 图标的桌面和开始菜单快捷方式：

```powershell
powershell -ExecutionPolicy Bypass -File desktop\scripts\create-shortcuts.ps1
```

打包后的 exe 产品名为 `DeepSeek Harness桌面版`，图标为 DSH 鲸鱼图标，右键菜单为标准 Windows 桌面程序菜单。

## 安装插件

**推荐：预构建 tarball（无需 allowBuilds）**

```sh
dsh plugin --profile web add https://github.com/TianYa-DAO/dsh-wallpaper-engine/releases/download/dsh-0.1.2/dsh-wallpaper-engine-0.1.2.tgz
```

**备选：GitHub 源码安装（需放行构建脚本）**

```sh
dsh plugin --profile web add github:TianYa-DAO/dsh-wallpaper-engine#path:/packages/dsh-wallpaper-engine
```

> GitHub 源码安装时 pnpm 会拦截 `prepare` 构建脚本。若提示 `allowBuilds`，在 `~\.dsh\profiles\web\pnpm-workspace.yaml` 中加上 `allowBuilds: true` 后重试。

安装后打开 设置 → **桌面**（界面自定义）/ **壁纸**（壁纸库）。

## 从源码构建

```bat
pnpm --dir desktop install
pnpm --dir desktop run build
pnpm --dir desktop run package:win
```

插件包自带预构建的 `lib/client.js`；可用自包含 prepare 脚本重建：

```bat
cd packages\dsh-wallpaper-engine
pnpm install
pnpm run prepare
```

## License

MIT

## 致谢 / Acknowledgements

- 毛玻璃效果参考 [kevinbism/liquid-glass-effect](https://github.com/kevinbism/liquid-glass-effect)（MIT）和 [olii-dev/liquid-glass](https://github.com/olii-dev/liquid-glass)（MIT）的 CSS backdrop-filter 实现
- Wallpaper Engine 本地库扫描与运行时设计参考 [Mineradio](https://github.com/nicepkg/mineradio)（GPL-3.0）的 wallpaper-engine-library 和 wallpaper-engine-runtime
