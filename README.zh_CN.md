<a name="readme-top"></a>

<div align="center">

<img src="https://raw.githubusercontent.com/bbjyzzwwy/jetbrains-git-graph/main/images/assets/logo-128.png" width="80" />

<h1>JetGit - JetBrains Git Graph, Commit & Shelf for VS Code</h1>

独立维护的 IntelliJ IDEA / JetBrains 风格 Git 工具：提交图、Commit 面板、分支管理、Cherry-Pick、Rebase 和三路合并编辑器。

> 本项目是 [aotemj/jetbrains-git-graph](https://github.com/aotemj/jetbrains-git-graph) 的独立维护 fork，最早源自 [zhyc9de/jet-git](https://github.com/zhyc9de/jet-git)。上游更新会按本项目方向选择性合并或 cherry-pick。

[English](./README.md) · **简体中文**

</div>

---

## 功能特性

### 分支右键菜单

右键任意分支即可执行 Checkout、创建、合并、Rebase、重命名、删除、Push、Pull 等操作，与 IntelliJ IDEA 体验一致。

![分支 Checkout](https://raw.githubusercontent.com/bbjyzzwwy/jetbrains-git-graph/main/images/checkout.gif)

### 提交右键菜单

右键任意提交即可复制 Hash、Cherry-Pick、Checkout、Reset、Revert、创建分支或标签。

![提交右键菜单](https://raw.githubusercontent.com/bbjyzzwwy/jetbrains-git-graph/main/images/commit-context-menu.gif)

### 变更文件右键菜单

右键变更文件面板中的文件：查看 Diff、编辑源文件、打开仓库版本、还原/Cherry-Pick 文件变更、复制路径。

### Git 提交图

![Git Graph](https://raw.githubusercontent.com/bbjyzzwwy/jetbrains-git-graph/main/images/git-graph.png)

- **分支树** — 按 Local / Remote / Tags 分组，支持搜索过滤
- **提交列表** — 彩色分支线，可调整列宽（Message、Author、Date、Hash）
- **详情面板** — 提交信息和变更文件树
- **过滤器** — 按分支、作者、日期范围过滤

### 三路合并编辑器

![三路合并编辑器](https://raw.githubusercontent.com/bbjyzzwwy/jetbrains-git-graph/main/images/three-way-merge.png)

- 三栏布局：Theirs | Result | Yours
- 冲突高亮 + 逐块操作按钮
- 完整语法高亮

### 冲突管理

![冲突列表](https://raw.githubusercontent.com/bbjyzzwwy/jetbrains-git-graph/main/images/conflicts-list.png)

- 快捷操作：接受 Yours / 接受 Theirs / 合并
- 与 VS Code 源代码管理面板无缝集成

---

## 所有右键菜单操作

<details>
<summary><b>分支（右键）</b></summary>

- Checkout — 切换分支
- New Branch from... — 从选中分支创建新分支
- Checkout and Rebase onto current — 切换并 Rebase 到当前分支
- Rebase current onto branch — 将当前分支 Rebase 到选中分支
- Merge into current — 合并到当前分支
- Rename — 重命名（仅本地分支）
- Delete — 删除（未合并时提示强制删除）
- Update — 拉取远程更新
- Push — 推送到远程

</details>

<details>
<summary><b>提交（右键）</b></summary>

- Copy Revision Number — 复制完整 Hash
- Cherry-Pick — Cherry-Pick 该提交
- Checkout Revision — 切换到该提交（Detached HEAD）
- Reset Current Branch to Here — 重置当前分支（Mixed/Soft/Hard）
- Revert Commit — 创建 Revert 提交
- New Branch... — 从该提交创建分支
- New Tag... — 在该提交创建标签

</details>

<details>
<summary><b>变更文件（右键）</b></summary>

- Show Diff — 打开 Diff 编辑器
- Edit Source — 在编辑器中打开文件
- Open Repository Version — 查看该提交时的文件版本
- Revert Selected Changes — 还原文件到父提交状态
- Cherry-Pick Selected Changes — 将文件变更应用到工作区
- Copy Path — 复制文件路径
- Copy File Name — 复制文件名

</details>

---

## 安装

**从 Marketplace 安装：**

在 VS Code 扩展中搜索 **"JetGit"**，或从本 fork 的 Release 产物安装。

**从 .vsix 安装：**

1. 从 [Releases](https://github.com/bbjyzzwwy/jetbrains-git-graph/releases) 下载最新 `.vsix`
2. `Cmd+Shift+P` → "Extensions: Install from VSIX..."

## 环境要求

- VS Code 1.85.0+
- Git 已安装并在 PATH 中

## 本地开发

```bash
git clone https://github.com/bbjyzzwwy/jetbrains-git-graph.git
cd jetbrains-git-graph
pnpm install
cd webview && pnpm install && cd ..
```

按 **F5** 启动扩展开发宿主。

```bash
pnpm run watch          # 监听模式
pnpm run build          # 生产构建
pnpm run vsce:package   # 打包为 .vsix
```

## 致谢

- 原项目：[zhyc9de/jet-git](https://github.com/zhyc9de/jet-git)
- 上游 fork：[aotemj/jetbrains-git-graph](https://github.com/aotemj/jetbrains-git-graph)
- 图标：[IntelliJ IDEA Icons](https://intellij-icons.jetbrains.design/)（Apache 2.0 许可）

## 许可证

[MIT](./LICENSE)
