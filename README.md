# Peon Ping Copilot Hooks

Peon-ping style sound and desktop notification hooks for GitHub Copilot agent sessions in VS Code.

## Features

- Installs workspace hook files into `.github/hooks/`
- Downloads the `peon` sound pack from the PeonPing registry into `.github/hooks/packs/`
- Maps Copilot lifecycle events to peon-ping audio categories
- Plays audio files from the pack (with an optional terminal bell fallback) and sends desktop notifications
- Tracks prompt submissions to detect and de-duplicate rapid re-sends
- Adds a `PreToolUse` safety check that prompts for confirmation before potentially destructive operations

## Commands

| Command | Description |
|---|---|
| `Peon Ping: Install Copilot Hooks` | Install hook files into the current workspace |
| `Peon Ping: Remove Copilot Hooks` | Remove all installed hook files |
| `Peon Ping: Open Hook Config` | Open the editable hook configuration file |
| `Peon Ping: Toggle Enabled` | Enable or disable hooks without removing them |
| `Peon Ping: Sync Default Audio Pack` | Re-download the default peon audio pack from the registry |

## Installed files

| File | Purpose |
|---|---|
| `.github/hooks/peon-ping.json` | Hook registration manifest |
| `.github/hooks/peon-ping-hook.js` | Runtime hook script |
| `.github/hooks/peon-ping.config.json` | Editable configuration |
| `.github/hooks/packs/peon/*` | Audio files and pack manifest |

## Event mapping

| Copilot event | Audio category |
|---|---|
| `SessionStart` | `session.start` |
| `UserPromptSubmit` | `task.acknowledge` (or `user.spam` on repeated prompts) |
| `Stop` / `SubagentStop` | `task.complete` |
| `SubagentStart` | `task.acknowledge` |
| `PostToolUse` (error output) | `task.error` |
| `PostToolUse` (rate-limit output) | `resource.limit` |
| `PreToolUse` (destructive patterns) | `input.required` + `permissionDecision: ask` |

## Development

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host.

## License

MIT