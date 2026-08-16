# dsh-wallpaper-engine

DeepSeek Harness（`dsh`）的 Wallpaper Engine 面板、背景层和 Windows 桌面壳。

本仓库包含两部分：

```
packages/dsh-wallpaper-engine/   dsh 可安装 Web 插件（dsh.bundle + dsh.client）
desktop/                         Windows Electron 桌面壳
```

插件单独安装即可在 设置 → **桌面与壁纸** 使用网页版安全预览。在桌面壳中运行插件可解锁本地库识别、`dsh-wallpaper://` 媒体协议、原生 Wallpaper Engine Scene 播放，以及 M5 桌面模式（WorkerW 壁纸、桌面嵌入、桌面图标可见性）。

## Windows 用户快速开始

前置条件：已安装 DeepSeek Harness，保证 `dsh` 命令可用。桌面程序会在 3080 端口空闲时自动启动 `dsh web`。

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

打包后的 exe 产品名为 `DeepSeek Harness桌面版`，图标为 DSH 鲸鱼图标，右键菜单为标准 Windows 桌面程序菜单（打开、以管理员身份运行、固定到任务栏、打开文件所在位置）。

## 安装插件

```sh
dsh plugin --profile web add github:TianYa-DAO/dsh-wallpaper-engine
```

然后打开 设置 → **桌面与壁纸**。

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
