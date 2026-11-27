# Codex Goal

Codex Goal displays the current Codex goal and its elapsed time beside the agent's composer. Open the button to read or edit the objective, pause or resume it, or clear it.

The interface follows Paseo's language. It uses Simplified Chinese when selected and English for other languages. The composer button uses distinct icons for in-progress, paused, completed, blocked, usage-limited, and budget-limited goals. You can resume a blocked goal from the panel after resolving the blocker.

Desktop and web users can start or save a goal, edit it, pause or resume, open clear confirmation, and retry with keyboard shortcuts inside the Goal panel. You can change or unassign each shortcut in Settings → Plugins → Codex Goal.

If session sync fails, the plugin retries automatically. You can also retry from the Goal warning or, if the Goal button has yet to appear, from the composer's extra controls.

Each goal belongs to its own Codex session. Goal changes use the session's `/goal` command. The plugin reads the session's goal from Codex's local SQLite database on the Paseo host. While the agent is running, the displayed elapsed time estimates time since the latest recorded update and is reconciled when Codex records more progress.

Requires Paseo 0.16.0 or later, Codex CLI 0.128.0 or later, and a plugin runtime with Node.js 22.13 or later. The plugin appears on Codex agents. The Paseo daemon needs access to the npm registry to download the plugin and its locked runtime dependency.

The plugin reads the goal objective, status and elapsed time from the host's Codex data directory. It sends goal commands to the selected Paseo agent only when you use its controls. Goal text may be included in prompts sent by Codex to its configured model provider.
