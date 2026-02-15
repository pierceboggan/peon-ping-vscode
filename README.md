Peon Ping Copilot Hooks (VS Code Extension)
===========================================

`peon-ping` style notifications for GitHub Copilot agent sessions in VS Code using the new hooks integration.

What this implements
--------------------

*   Installs workspace hook files in `.github/hooks/`
*   Downloads the real `peon` sound pack from the PeonPing registry into `.github/hooks/packs/`
*   Maps Copilot hook events to peon-ping style categories
*   Plays real pack audio files (plus optional bell fallback) and desktop notifications
*   Tracks prompt spam and avoids repeating the same line back-to-back
*   Adds a basic `PreToolUse` safety check that sets `permissionDecision: "ask"` for potentially destructive tool input

Commands
--------

*   `Peon Ping: Install Copilot Hooks` - Set up hooks and download the default peon pack
*   `Peon Ping: Remove Copilot Hooks` - Remove hook files (preserves config and packs)
*   `Peon Ping: Open Hook Config` - Edit configuration settings
*   `Peon Ping: Toggle Enabled` - Quickly enable/disable sounds
*   `Peon Ping: Sync Default Audio Pack` - Re-download the peon pack
*   `Peon Ping: Download & Activate Sound Pack` - Browse and download any the available packs from the upstream peon-ping registry
*   `Peon Ping: Switch Active Pack` - Switch between your installed packs

Installed files
---------------

*   `.github/hooks/peon-ping.json` (hook registration)
*   `.github/hooks/peon-ping-hook.js` (runtime hook script)
*   `.github/hooks/peon-ping.config.json` (editable config)
*   `.github/hooks/packs/peon/*` (real audio files + manifest)

Event mapping
-------------

*   `SessionStart` → `session.start`
*   `UserPromptSubmit` → `task.acknowledge` (or `user.spam`)
*   `Stop` / `SubagentStop` → `task.complete`
*   `SubagentStart` → `task.acknowledge`
*   `PostToolUse` error-like output → `task.error`
*   `PostToolUse` rate-limit-like output → `resource.limit`
*   `PreToolUse` destructive patterns → `input.required` + `permissionDecision: ask`

Development
-----------

```
npm install
npm run compile

```

Press `F5` in VS Code to launch an Extension Development Host.