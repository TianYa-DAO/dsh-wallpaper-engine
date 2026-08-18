# dsh-wallpaper-engine

Wallpaper Engine panel, background layer, and Windows desktop shell for DeepSeek Harness (`dsh`).

This repository contains both pieces:

```
packages/dsh-wallpaper-engine/   Installable DSH web plugin (dsh.bundle + dsh.client)
desktop/                         Electron desktop shell for Windows
```

The plugin alone provides the Settings → **Desktop & Wallpaper** panel and a web-safe preview mode. Run it inside the desktop shell to unlock local library discovery, the `dsh-wallpaper://` media protocol, native Wallpaper Engine Scene playback, and M5 desktop mode (WorkerW wallpaper, desktop embed, desktop-icon visibility).

## About the plugin

`dsh-wallpaper-engine` is a DeepSeek Harness web plugin that adds a "Desktop & Wallpaper" settings section and a full-viewport background layer to `dsh web`. It installs with the standard `dsh plugin add` command and provides safe web previews on its own; paired with the `desktop/` shell it unlocks Steam Wallpaper Engine imports, native Scene playback, and Windows desktop mode.

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

**Recommended: prebuilt tarball (no allowBuilds needed)**

```sh
dsh plugin --profile web add https://github.com/TianYa-DAO/dsh-wallpaper-engine/releases/download/dsh-0.1.2/dsh-wallpaper-engine-0.1.2.tgz
```

**Alternative: GitHub source (requires allowBuilds)**

```sh
dsh plugin --profile web add github:TianYa-DAO/dsh-wallpaper-engine#path:/packages/dsh-wallpaper-engine
```

> When installing from GitHub source, pnpm blocks the `prepare` build script. If you see an `allowBuilds` error, add `allowBuilds: true` to `~\.dsh\profiles\web\pnpm-workspace.yaml` and retry.

After installation, open Settings → **Desktop** (appearance) / **Wallpaper** (library).

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
