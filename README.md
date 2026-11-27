# Codex Goal for Paseo

[简体中文](README.zh-CN.md)

Codex Goal displays the current goal's elapsed time beside the composer in Codex sessions. Open the button to view its status and full objective, create or edit a goal, pause, resume, or clear it.

The interface follows Paseo's language setting: Simplified Chinese is available, and other languages use English. The Goal button uses distinct icons for active, paused, completed, blocked, usage-limited, and budget-limited goals. Once a blocker is resolved, you can resume from the Goal panel.

Elapsed time is based on the seconds recorded by Codex. While a goal is active and the session is running, the interface estimates the time since the last recorded update and reconciles it when Codex writes a new total. Pausing stops further goal progress, though the current turn may continue. Editing uses the native `/goal <objective>` command and attempts to activate the goal.

The plugin reads only the current session's goal. Each operation is initiated by the user and executed through Paseo's native `/goal` command.

## Keyboard shortcuts

On desktop and web, shortcuts apply while the Goal panel has focus. The defaults are **Enter** to start or save, **Shift+Enter** for a new line, **E** to edit, **P** to pause or resume, **Delete** to open clear confirmation, and **R** to retry after a read or sync failure. On wide layouts, Paseo closes the panel with **Esc**.

Under **Settings → Plugins → Codex Goal**, choose the save binding from its dropdown. To change an edit, pause/resume, clear, or retry binding, click its current key and type one letter or choose **Delete**. Choose **Unassigned** to disable a shortcut. Settings are saved per Paseo host.

These desktop and mobile layout previews are rendered in a browser with sample data.

| Desktop | Mobile |
| --- | --- |
| ![Desktop preview](assets/desktop.png) | ![Mobile preview](assets/mobile.png) |

## Installation

Requires Paseo client and daemon 0.16.0 or later, a version of Codex that supports `/goal` (Paseo's minimum is Codex CLI 0.128.0), and a plugin runtime with `node:sqlite` (Node.js 22.13 or later).

Install the reviewed release from the [Paseo plugin marketplace](https://paseo.sh/plugins/fu021/codex-goal). Run the CLI commands on the machine running the Paseo daemon.

```sh
paseo plugin install fu021/codex-goal
paseo plugin ls
```

Enable plugins under **Settings → Plugins** and make sure the daemon can reach the npm registry. To install directly from npm, use `paseo plugin install npm:codex-goal`. Marketplace installations use the version approved by Paseo. Direct npm installations can select a specific release with `npm:codex-goal@<version>`.

### Migrate from the Git edition

If you installed from the former `fu021/codex-goal-ui` listing or directly from Git, run `paseo plugin ls` to identify the existing installation. Record any custom keyboard shortcuts, run `paseo plugin remove <installed-id>` to remove the Git installation, then install `fu021/codex-goal` as shown above. Reapply your shortcuts in **Settings → Plugins → Codex Goal**. Codex stores your goals separately, so they remain available after migration.

Return to any Codex session and find **Goal** in the plugin button area beside the composer. When using a remote host, both the plugin and Codex data must be on that host.

The plugin queries Codex's local SQLite database in read-only mode. It uses the Codex data directory by default and supports `CODEX_HOME`, `CODEX_SQLITE_HOME`, and the top-level `sqlite_home` setting in the user's `config.toml`. If a launch script sets a different data directory for an individual session, point Paseo's Codex Provider environment variables to the same directory.

## Development

For local development, install dependencies and run the checks in this directory:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
```

GitHub Actions runs type checking and regression tests on Node.js 22 and 24 for pushes to `main` and pull requests.

If you trust this plugin and have enabled plugins under **Settings → Plugins** in Paseo, run the following commands in the same directory:

```sh
paseo plugin install "$PWD"
paseo plugin ls
```

## Release

Publish new versions through the [codex-goal npm package](https://www.npmjs.com/package/codex-goal). GitHub hosts the source and runs CI on `main`.

Staged publishing requires Node.js 22.14 or later, npm 11.15 or later, and an npm account with publish access and two-factor authentication enabled.

1. Update the version in `package.json` and `npm-shrinkwrap.json`, run the development checks, and inspect the package with `npm pack --dry-run --ignore-scripts`.
2. Stage the package with `npm stage publish`. Use `npm stage list codex-goal` to find the stage ID, then run `npm stage approve <stage-id>` and complete npm two-factor authentication to publish it.
3. On a test daemon, install the exact release with `paseo plugin install npm:codex-goal@<version>`, check that it is running, and exercise the Goal panel.
4. Check the automatic update PR for `fu021/codex-goal` in the Paseo registry. The marketplace serves the new version after Paseo approves and merges that update.

[npm staged publishing](https://docs.npmjs.com/staged-publishing/) · [Paseo plugin publishing](https://paseo.sh/docs/plugins/publishing)
