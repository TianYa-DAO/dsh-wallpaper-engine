# dsh-wallpaper-engine

Wallpaper Engine panel, background layer, and Windows desktop shell for DeepSeek Harness (`dsh`).

This repository contains both pieces:

```
packages/dsh-wallpaper-engine/   Installable DSH web plugin (dsh.bundle + dsh.client)
desktop/                         Electron desktop shell for Windows
```

The plugin alone provides the Settings → **Desktop & Wallpaper** panel and a web-safe preview mode. Run it inside the desktop shell to unlock local library discovery, the `dsh-wallpaper://` media protocol, native Wallpaper Engine Scene playback, and M5 desktop mode (WorkerW wallpaper, desktop embed, desktop-icon visibility).

## Quick start for Windows users

Prerequisite: install DeepSeek Harness so the `dsh` command is available. The desktop app starts `dsh web` automatically when port 3080 is idle.

1. Download and unzip the latest Windows package from GitHub Releases, or clone this repository.
2. Run:

```bat
start-dsh-desktop.bat
```

The bat prefers the prebuilt app in `desktop\release\DeepSeek Harness桌面版-win32-x64\DeepSeek Harness桌面版.exe` and falls back to the development Electron shell.

To create desktop and Start-menu shortcuts with the DSH icon:

```powershell
powershell -ExecutionPolicy Bypass -File desktop\scripts\create-shortcuts.ps1
```

The packaged exe carries the product name `DeepSeek Harness桌面版`, the DSH whale icon, and the standard Windows shortcut right-click menu (open, run as administrator, pin to taskbar, open file location).

## Install the plugin

```sh
dsh plugin --profile web add github:TianYa-DAO/dsh-wallpaper-engine
```

Then open Settings → **Desktop & Wallpaper**.

## Build from source

```bat
pnpm --dir desktop install
pnpm --dir desktop run build
pnpm --dir desktop run package:win
```

The plugin package ships prebuilt `lib/client.js`; rebuild it with the self-contained prepare script:

```bat
cd packages\dsh-wallpaper-engine
pnpm install
pnpm run prepare
```

## License

MIT
