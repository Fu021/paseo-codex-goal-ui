# Codex Goal

Codex Goal displays the current Codex goal and its elapsed time beside the agent's composer. Open the button to read or edit the objective, pause or resume it, or clear it.

The interface follows Paseo's language. It uses Simplified Chinese when selected and English for other languages. The composer button shows a different icon for in-progress, paused, and completed goals.

If session sync fails, the plugin retries automatically. You can also retry from the Goal warning or, if the Goal button has yet to appear, from the composer's extra controls.

Each goal belongs to its own Codex session. Goal changes use the session's `/goal` command. The plugin reads the session's goal from Codex's local SQLite database on the Paseo host. While the agent is running, the displayed elapsed time estimates time since the latest recorded update and is reconciled when Codex records more progress.

Requires Paseo 0.17.4 or later, Codex CLI 0.128.0 or later, and a plugin runtime with Node.js 22.13 or later. The plugin appears on Codex agents; other providers are not supported. The daemon needs npm to prepare the plugin's locked runtime dependency.

The plugin reads the goal objective, status and elapsed time from the host's Codex data directory. It sends goal commands to the selected Paseo agent only when you use its controls. Goal text may be included in prompts sent by Codex to its configured model provider.
