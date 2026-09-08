# Life Pivot · 个人积累库框架

基于本地版本 `0.23.1` 导出的独立源码框架，保留网页界面、功能模块、数据库表结构、测试与桌面端构建脚本。

不包含个人数据库、记录附件、PDF、个人截图、安装包、开发日志或原项目提交历史。首次运行时会在指定目录创建独立数据库。

## 本地运行

需要 Node.js 24 或更新版本。

```bash
npm ci
LIFE_OS_DATA_ROOT="$PWD/.data" npm run dev
```

打开 http://127.0.0.1:3000 。使用上述独立数据目录，避免与电脑上已安装的个人积累库共用记录。

## 检查与构建

```bash
npm run typecheck
npm run test:run
npm run build
```

Apple Silicon Mac 桌面端打包：

```bash
npm run desktop:pack:mac:arm64
```

## 目录

- `src/app`：页面、交互和 API。
- `src/modules`：每日记录、健身、阅读、睡眠、护肤等功能。
- `src/core`：数据库、备份及基础能力。
- `drizzle`：数据库结构迁移，不包含个人数据文件。
- `public`：界面使用的背景和人体图等静态素材。
- `desktop`：Electron 桌面端及打包脚本。
- `tests`：端到端测试。

GitHub 提供源码托管；本仓库本身不是在线服务。
