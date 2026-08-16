# dsh-wallpaper-engine

Wallpaper Engine panel and background layer for the DeepSeek Harness (`dsh`) Web UI.

This is the installable plugin package. It registers a **Desktop & Wallpaper** settings section with a lazy-loaded local Wallpaper Engine library (Steam workshop/local projects and manual imports), search, import/remove, set-as-background with opacity/blur/fill controls, and a full-viewport background layer. Scene projects can run through the native Wallpaper Engine runtime when the DSH desktop shell exposes its `window.desktopWindow` bridge; in a plain browser the panel shows the "desktop version" hint and the web app is unchanged.

## Install

From a GitHub repo:

```sh
dsh plugin --profile web add <your-git-repo-url>
```

From a local checkout:

```sh
dsh plugin --profile web add ./plugin-package/dsh-wallpaper-engine
```

Then open Settings → **Desktop & Wallpaper**.

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

## Attribution

The library-discovery and import UX follows Mineradio's GPL-3.0 Wallpaper Engine implementation as a reference design only. This package is an independent TypeScript implementation: it indexes local `project.json` metadata, never executes imported Web/Application projects, and never reads files outside a project root.

## License

MIT
