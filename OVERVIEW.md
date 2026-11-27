# Codex Goal

Codex Goal shows your goal status and elapsed time beside the composer in each Codex session. Open the Goal panel to set, edit, pause, resume, or clear the current goal.

The plugin reads the session's goal from Codex's local SQLite database and uses Codex's native `/goal` command when you change it. While the agent is running, the timer estimates elapsed time between Codex's recorded updates.

## Requirements

Requires Paseo 0.16.0 or later, Codex CLI 0.128.0 or later, and a plugin runtime with Node.js 22.13 or later. Enable plugins on the Paseo host where Codex runs. The daemon needs access to the npm registry to download the reviewed package and its runtime dependency.

## Controls and shortcuts

The Goal button shows a distinct icon and color for each state, including when there is no goal or it could not be read. Open it in the desktop popover or mobile sheet to see the details or set a new goal. After resolving a blocker, choose Resume to continue. If session sync fails, the plugin retries automatically. To retry manually, open the warning or use the composer's extra controls.

On desktop and web, use keyboard shortcuts inside the Goal panel to start or save, edit, pause or resume, open clear confirmation, or retry. Change or unassign shortcuts in Settings → Plugins → Codex Goal. The plugin interface follows Paseo's language, with English and Simplified Chinese available.

## Data access

The plugin reads the goal objective, status and elapsed time from the host's Codex data directory. It sends goal commands to the selected Paseo agent only when you use its controls. Goal text may be included in prompts sent by Codex to its configured model provider.
