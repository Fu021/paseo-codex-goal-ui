# Codex Goal for Paseo

[English](README.md)

在 Codex 会话的输入框旁显示 Goal 的累计运行时间。点开按钮可查看状态和完整目标、创建或编辑目标、暂停、继续和清除。

界面跟随 Paseo 的语言设置，支持简体中文，其他语言使用英文。Goal 按钮用不同图标区分进行中、已暂停、已完成、受阻和用量或预算限制。排除阻碍后，可以从 Goal 面板继续。

累计时间以 Codex 已记录的秒数为准。Goal 活跃且会话正在运行时，界面会估算最近一次目标更新后的本轮耗时，并在 Codex 写入新的累计值时校准。暂停停止目标的后续推进，当前一轮仍可能继续。编辑使用原生 `/goal <目标>`，会尝试激活目标。

这里的插件只读取当前会话的目标记录。每次操作均由用户点击发起，通过 Paseo 原生 `/goal` 执行。

以下是用示例数据在浏览器中渲染的桌面和手机布局预览。

| 桌面 | 手机 |
| --- | --- |
| ![桌面预览](assets/desktop.png) | ![手机预览](assets/mobile.png) |

## 安装

需要 Paseo 客户端和 daemon 0.17.4 或更新版本、支持 `/goal` 的 Codex（Paseo 的最低版本要求为 Codex CLI 0.128.0），以及提供 `node:sqlite` 的插件运行时（Node.js 22.13+）。

插件可以在运行 Paseo daemon 的机器上从 GitHub 直接安装：

```sh
paseo plugin install git:Fu021/paseo-codex-goal-ui
paseo plugin ls
```

这需要启用并信任 Paseo 插件，且 daemon 能访问 GitHub 和 npm 注册表。

本地开发时，在此目录安装依赖并运行检查。

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
```

GitHub Actions 会在推送到 `main` 和提交 PR 时，用 Node.js 22 和 24 运行类型检查和回归测试。

如果你信任此插件，并且已在 Paseo 的 **设置 → 插件** 启用插件，在同一目录执行以下命令。

```sh
paseo plugin install "$PWD"
paseo plugin ls
```

回到任意 Codex 会话，在输入框的插件按钮区找到 **Goal**。使用远程主机时，插件和 Codex 数据都要位于该主机。

插件以只读方式查询 Codex 的本地 SQLite。默认使用 Codex 数据目录，支持 `CODEX_HOME`、`CODEX_SQLITE_HOME` 和用户 `config.toml` 顶层的 `sqlite_home`。如果启动脚本为单个会话另设数据目录，请让 Paseo 的 Codex Provider 环境变量指向同一目录。
