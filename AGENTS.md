# AGENTS.md

这是一个 VSCode 插件项目，旨在将 JetBrains 的 Git 插件体验迁移到 VSCode 中。

每次会话完后，如果改动了代码，都将插件编译安装到本地。

## Fork 关系

```
zhyc9de/jet-git (original, 8 commits, last: 4aa7125)
  └── aotemj/jetbrains-git-graph (upstream / PR target, 146+ commits)
        └── bbjyzzwwy/jetbrains-git-graph (origin — my fork)
```


## Commit 规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：`<type>: <description>`

| 类型 | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `chore` | 工具、依赖、重构 |
| `docs` | 文档 |
| `refactor` | 代码重构（无行为变更） |
| `style` | 格式化、CSS 变更 |

## 代码规范

- **格式化/Lint**: `biome check`（配置见 biome.json）
- **Extension Host**: TypeScript + Node.js，child_process 调用 Git CLI
- **Webview**: React 19, Zustand, allotment, @tanstack/react-virtual, shiki, diff, node-diff3
- **通信**: postMessage via MessageRouter（src/messages/protocol.ts ↔ webview/src/shared/bridge/types.ts 类型同步）
- **图形渲染**: SVG + DOM（非 Canvas）
- **Git**: 直接 CLI 调用，`\x00` 分隔符解析（不用 simple-git）
- **包管理**: pnpm（monorepo with pnpm-workspace.yaml）
- **不要主动升级 React 或 Vite 版本**（已固定版本）

## 项目结构

```
src/                    Extension Host (TypeScript + Node.js)
  ├── extension.ts        入口，命令注册 & MessageRouter
  ├── git/                Git CLI 包装（gitService, graphLayout, types）
  ├── messages/           通信协议（protocol, messageRouter）
  └── views/              Webview 管理器（mergeEditor, conflicts, diffEditor, html）
webview/src/
  ├── commit/             Commit 面板（Changes、Unversioned Files、提交操作）
  ├── panel/              Git Log 面板（Graph, CommitList, BranchTree, DetailPanel）
  ├── push/               Push 确认面板
  ├── rollback/           Rollback 确认面板
  ├── compare/            Compare with Local 变更面板
  ├── conflicts/          冲突列表 + 三方合并编辑器
  ├── shared/             共享模块（bridge, store, hooks, components, theme）
  └── main.tsx            路由入口（mode: panel | commit | push | rollback | compare | merge | conflicts）
```

## 编译安装命令

每次修改代码后，执行以下命令编译并安装插件到本地 VS Code：

```bash
# 1. 编译 extension + webview
pnpm run build

# 2. 打包成 .vsix
vsce package --no-dependencies

# 3. 安装到本地 VS Code
code --install-extension idea-like-git-graph-0.4.15.vsix --force
```

安装完成后，在 VS Code 中按 `Ctrl+Shift+P` → `Developer: Reload Window` 重新加载窗口即可生效。

## PR 发布前检查

- `pnpm run compile` 通过（check-types + lint + esbuild）
- `pnpm run build` 通过（extension + webview）
- 分支已 rebase 到最新 `upstream/main`
- 改动集中、最小化——每个 PR 只关注一个问题
- 普通 PR 不改变 `package.json` 版本号；发布版本时按需显式升版本
