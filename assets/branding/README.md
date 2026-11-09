# NofyAI 品牌资源

从本机兄弟项目 `nofy-api/web/public/branding/nofyai-v1/` 原样复制：

- `nofyai-icon-1024.png`：NofyAI 原始品牌标识，作为桌面图标的内嵌素材。
- `nofyai-icon-192.png`：收起侧栏的品牌图标。
- `nofyai-logo-light.png`、`nofyai-logo-dark.png`：浅色与深色界面的品牌标识。
- `nofyai-favicon.ico`：浏览器预览页签图标。

颜色取自 `nofy-api/web/src/styles/nofyai.css` 中的 NofyAI 品牌主题，并映射到本项目 `src/styles.css` 的 shadcn 语义变量。

这些资源未经过重绘、裁切或颜色修改。更新资源时同步检查两种主题和应用打包配置。

## 桌面应用图标

`nofy-helper-app.svg` 将原始 PNG 标识原样嵌入暖白圆角底板；`nofy-helper-app.png` 为同一矢量布局的 1024×1024 导出，用于 Electron 窗口、macOS Dock 和跨平台打包。底板宽 880px，原标识可见宽度 608px，减少直接使用品牌原图时过多透明留白造成的缩小感。界面 Logo 继续使用上述原始资源。

使用 `node scripts/build-app-icon.mjs` 重新生成（需要本机 Chrome 和开发依赖中的 playwright-core）。脚本测量原图透明边界并布局，不重画或修改品牌标识。不采用生成式图像预览，其透明边缘不符合桌面图标要求。
