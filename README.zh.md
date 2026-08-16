# dsh-wallpaper-engine

DeepSeek Harness（`dsh`）Web UI 的 Wallpaper Engine 面板和背景层。

这是可安装的插件包。它注册一个 **桌面与壁纸** 设置区，包含懒加载的本地 Wallpaper Engine 库（Steam 创意工坊/本地项目和手动导入）、搜索、导入/移除、设为背景（支持不透明度/模糊/填充方式），以及全屏背景层。当 DSH 桌面壳暴露 `window.desktopWindow` 桥接时，Scene 项目可以通过原生 Wallpaper Engine 运行时运行；在普通浏览器中，面板显示“桌面版支持”提示，网页版行为不变。

## 安装

从 GitHub 仓库安装：

```sh
dsh plugin --profile web add <你的仓库地址>
```

从本地目录安装：

```sh
dsh plugin --profile web add ./plugin-package/dsh-wallpaper-engine
```

然后打开 设置 → **桌面与壁纸**。

## 桌面桥接

媒体发现、导入对话框、`dsh-wallpaper://` 媒体协议和原生 Scene 启停运行在 DSH 桌面壳中（主仓库的 `apps/desktop`）。请单独安装桌面壳，并让它加载运行中的 `dsh web`：

```bat
pnpm --filter @deepseek-ai/dsh-desktop run start
```

## 开发

```sh
pnpm install
pnpm run build   # tsc + tsdown；生成 lib/client.js
```

官方 `@deepseek-ai/*` 包都声明为 `peerDependencies`，由 DSH 运行时提供。

## License

MIT
