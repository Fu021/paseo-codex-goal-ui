# Paseo 插件 Codex Goal

- GitHub 源码仓库为 `Fu021/paseo-codex-goal`，主分支为 `main`。公开 npm 包名为 `codex-goal`，Paseo 市场条目 ID 为 `fu021/codex-goal`。
- `index.client.tsx` 注册 Paseo 界面，`client/` 包含 Goal 面板、翻译和快捷键设置。`index.server.ts` 处理目标操作，`server/store.ts` 以只读方式查询 Codex 的 SQLite 数据库，`shared/` 定义 RPC 和设置。目标变更通过所选会话的原生 `/goal` 命令执行。
- 最低版本为 Paseo 0.16.0、Codex CLI 0.128.0 和 Node.js 22.13（插件运行环境）。使用 Paseo 的公开 SDK。

## 开发与测试

- 遇到复杂任务，或用户持续提出需要排队的任务时，主动创建 Goal 或更新现有 Goal，记录待办与进展，并随任务变化及时维护。
- 运行 `npm ci --ignore-scripts`、`npm run typecheck` 和 `npm test`。GitHub Actions 使用 Node.js 22 和 24 进行检查。
- 在隔离的 Paseo daemon 上验证运行时变更。修改界面后，检查桌面宽屏和手机窄屏布局，包括图标与文字对齐、固定状态配色和清除确认。修改快捷键后，在桌面端或网页端将焦点放在面板内进行验证。
- 长期复用的工具链放在持久目录。验证完成后，清理一次性测试 daemon、打包产物和预览文件。

## 插件市场

- 在 `OVERVIEW.md` 和 `OVERVIEW.zh-CN.md` 中分别维护英文和简体中文介绍，并在 `paseo-plugin.json` 的 `translations.zh-CN` 中维护中文元数据。npm 包须包含两份介绍。
- 三张市场展示图统一使用英文和 16:10 比例。用示例数据截取实际 Paseo 界面，封面 `assets/market.png` 展示全部八种状态图标，`assets/desktop.png` 和 `assets/mobile.png` 展示各自布局下的常用状态。

## 发布

1. 同步更新 `package.json` 和 `npm-shrinkwrap.json` 的版本号。运行检查，再用 `npm pack --dry-run --ignore-scripts` 确认打包包含双语介绍、清单和展示图。将发布提交推送到 `main`，确认 CI 通过。
2. 正式版本只通过 npm 发布。运行 `npm stage publish`，然后运行 `npm stage approve <stage-id>`，由发布者完成双重验证。确认公开版本后，在测试 daemon 上安装 `npm:codex-goal@<version>` 并验证基本功能。
3. 等待 `getpaseo/plugins` 检测 npm 的 `latest` 并自动创建更新 PR。常规发布无需 fork 市场仓库，也无需手动开 Issue 或提 PR。跟进机器人 PR 的审核和合并，确认市场已更新到获批版本。
