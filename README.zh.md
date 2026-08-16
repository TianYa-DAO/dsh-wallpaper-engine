# dsh-wallpaper-engine

DeepSeek Harness（`dsh`）的 Wallpaper Engine 面板、背景层和 Windows 桌面壳。

本仓库包含两部分：

```
packages/dsh-wallpaper-engine/   dsh 可安装 Web 插件（dsh.bundle + dsh.client）
desktop/                         Windows Electron 桌面壳
```

插件单独安装即可在 设置 → **桌面与壁纸** 使用网页版安全预览。在桌面壳中运行插件可解锁本地库识别、`dsh-wallpaper://` 媒体协议、原生 Wallpaper Engine Scene 播放，以及 M5 桌面模式（WorkerW 壁纸、桌面嵌入、桌面图标可见性）。

## 安装插件

```sh
dsh plugin --profile web add github:TianYa-DAO/dsh-wallpaper-engine
```

然后打开 设置 → **桌面与壁纸**。

## 安装并运行桌面壳

前置条件：Windows、Node 22、pnpm，且 `dsh web` 已在 `http://127.0.0.1:3080` 运行。

```bat
pnpm run desktop:install
pnpm run desktop
```

或者双击仓库根目录的 `start-dsh-desktop.bat`；它会等待 `dsh web` 就绪后再显示窗口。

## 从源码构建

```bat
pnpm --dir desktop install
pnpm --dir desktop run build
```

插件包自带预构建的 `lib/client.js`；可用自包含 prepare 脚本重建：

```bat
cd packages\dsh-wallpaper-engine
pnpm install
pnpm run prepare
```

## License

MIT
