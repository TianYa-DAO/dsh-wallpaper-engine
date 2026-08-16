# dsh-wallpaper-engine

Wallpaper Engine panel and background layer for the DeepSeek Harness (`dsh`) Web UI.

This is the installable plugin package. It registers a **Desktop & Wallpaper** settings section with a lazy-loaded local Wallpaper Engine library (Steam workshop/local projects and manual imports), search, import/remove, set-as-background with opacity/blur/fill controls, and a full-viewport background layer. Scene projects can run through the native Wallpaper Engine runtime when the DSH desktop shell exposes its `window.desktopWindow` bridge; in a plain browser the panel shows the "desktop version" hint and the web app is unchanged.

## Install

From a GitHub repo:

```sh
dsh plugin --profile web add https://github.com/TianYa-DAO/dsh-wallpaper-engine
```

From a local checkout:

```sh
dsh plugin --profile web add ./plugin-package/dsh-wallpaper-engine
```

Then open Settings → **Desktop & Wallpaper**. Inside the desktop shell the panel also exposes desktop-mode controls: WorkerW wallpaper window, desktop embed, and desktop-icon visibility.

## Desktop bridge

Media discovery, import dialogs, the `dsh-wallpaper://` media protocol, and native Scene start/stop run in the DSH desktop shell (`apps/desktop` of the main repository). Install the shell separately and launch it over a running `dsh web`:

```bat
pnpm --filter @deepseek-ai/dsh-desktop run start
```

## Development

```sh
pnpm install
pnpm run build   # tsc + tsdown; emits lib/client.js
```

Official `@deepseek-ai/*` packages are `peerDependencies`; the DSH runtime provides them.

## License

MIT
