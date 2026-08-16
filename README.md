# dsh-wallpaper-engine

Wallpaper Engine panel, background layer, and Windows desktop shell for DeepSeek Harness (`dsh`).

This repository contains both pieces:

```
packages/dsh-wallpaper-engine/   Installable DSH web plugin (dsh.bundle + dsh.client)
desktop/                         Electron desktop shell for Windows
```

The plugin alone provides the Settings → **Desktop & Wallpaper** panel and a web-safe preview mode. Run it inside the desktop shell to unlock local library discovery, the `dsh-wallpaper://` media protocol, native Wallpaper Engine Scene playback, and M5 desktop mode (WorkerW wallpaper, desktop embed, desktop-icon visibility).

## Install the plugin

```sh
dsh plugin --profile web add github:TianYa-DAO/dsh-wallpaper-engine
```

Then open Settings → **Desktop & Wallpaper**.

## Install and run the desktop shell

Prerequisites: Node 22, pnpm, Windows, and a running `dsh web` on `http://127.0.0.1:3080`.

```bat
pnpm run desktop:install
pnpm run desktop
```

Or double-click `start-dsh-desktop.bat` at the repository root; it waits for `dsh web` to be ready before showing the window.

## Build from source

```bat
pnpm --dir desktop install
pnpm --dir desktop run build
```

The plugin package ships prebuilt `lib/client.js`; rebuild it with the self-contained prepare script:

```bat
cd packages\dsh-wallpaper-engine
pnpm install
pnpm run prepare
```

## License

MIT
