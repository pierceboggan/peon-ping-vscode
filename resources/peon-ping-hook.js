#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const CONFIG_PATH = path.join(__dirname, "peon-ping.config.json");
const STATE_PATH = path.join(__dirname, ".peon-ping-state.json");

const DEFAULT_CONFIG = {
  enabled: true,
  bell: false,
  desktopNotifications: true,
  activePack: "peon",
  packsDir: "./packs",
  volume: 0.5,
  spamThreshold: 3,
  spamWindowSeconds: 10,
  categories: {
    "session.start": true,
    "task.acknowledge": true,
    "task.complete": true,
    "task.error": true,
    "input.required": true,
    "resource.limit": true,
    "user.spam": true,
  },
  labels: {
    "session.start": ["Ready to work?", "Work, work.", "Jobs done."],
    "task.acknowledge": ["On it.", "Something need doing?", "I gotcha."],
    "task.complete": ["Done and done.", "Job's done.", "All set."],
    "task.error": ["That did not work.", "Something broke.", "Need a retry."],
    "input.required": ["Need your approval.", "Permission needed.", "Action required."],
    "resource.limit": ["Resource limit hit.", "Rate limit reached.", "Quota exceeded."],
    "user.spam": ["Me busy, leave me alone.", "One at a time.", "Too many prompts."],
  },
  dangerousCommandPatterns: [
    "rm\\s+-rf\\s+/",
    "\\bdrop\\s+table\\b",
    "\\bmkfs\\b",
    "\\bshutdown\\b",
    "\\breboot\\b",
    "\\bformat\\s+c:\\\\",
  ],
};

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function safeWriteJson(filePath, payload) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  } catch {
  }
}

function readStdinJson() {
  return new Promise((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(input.trim() ? JSON.parse(input) : {});
      } catch {
        resolve({});
      }
    });
    process.stdin.resume();
  });
}

function runDetached(command, args) {
  try {
    const child = cp.spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function commandExists(command) {
  try {
    const checkCommand = process.platform === "win32" ? "where" : "which";
    const result = cp.spawnSync(checkCommand, [command], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function clampVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0.5;
  }

  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

function ringBell() {
  try {
    process.stderr.write("\u0007");
  } catch {
  }
}

function escapeAppleScript(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sendDesktopNotification(title, message) {
  if (process.platform === "darwin") {
    const command = `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"`;
    runDetached("osascript", ["-e", command]);
    return;
  }

  if (process.platform === "linux") {
    runDetached("notify-send", [title, message]);
    return;
  }

  if (process.platform === "win32") {
    const safeTitle = String(title).replace(/"/g, "'");
    const safeMessage = String(message).replace(/"/g, "'");
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$n = New-Object System.Windows.Forms.NotifyIcon",
      "$n.Icon = [System.Drawing.SystemIcons]::Information",
      `$n.BalloonTipTitle = \"${safeTitle}\"`,
      `$n.BalloonTipText = \"${safeMessage}\"`,
      "$n.Visible = $true",
      "$n.ShowBalloonTip(3000)",
      "Start-Sleep -Milliseconds 3300",
      "$n.Dispose()",
    ].join("; ");

    runDetached("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
  }
}

function containsPattern(value, patterns) {
  if (!value) {
    return false;
  }

  const joined = typeof value === "string" ? value : JSON.stringify(value);
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, "i").test(joined);
    } catch {
      return false;
    }
  });
}

function sanitizeRelativePath(input) {
  const normalized = path.posix.normalize(String(input).replace(/\\/g, "/")).replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("..")) {
    return undefined;
  }

  return normalized;
}

function pickLabel(category, config, state) {
  const labels = (config.labels && config.labels[category]) || [];
  if (!Array.isArray(labels) || labels.length === 0) {
    return category;
  }

  const last = state.lastPlayedLabel[category] || "";
  const candidates = labels.length <= 1 ? labels : labels.filter((label) => label !== last);
  const next = candidates[Math.floor(Math.random() * candidates.length)] || labels[0];
  state.lastPlayedLabel[category] = next;
  return next;
}

function checkSpam(state, config) {
  const now = Date.now() / 1000;
  const windowSeconds = Number(config.spamWindowSeconds || 10);
  const threshold = Number(config.spamThreshold || 3);
  const cutoff = now - windowSeconds;

  state.promptTimestamps = (state.promptTimestamps || []).filter((stamp) => stamp >= cutoff);
  state.promptTimestamps.push(now);

  return state.promptTimestamps.length >= threshold;
}

function getPackContext(config) {
  const activePack = String(config.activePack || "peon");
  const packsDirSetting = String(config.packsDir || "./packs");
  const packsDir = path.resolve(__dirname, packsDirSetting);
  const packDir = path.join(packsDir, activePack);

  const candidates = [
    path.join(packDir, "openpeon.json"),
    path.join(packDir, "manifest.json"),
  ];

  for (const manifestPath of candidates) {
    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      return { manifest, packDir, activePack };
    } catch {
    }
  }

  return undefined;
}

function pickSound(category, manifest, state) {
  const categoryEntry = manifest?.categories?.[category];
  const sounds = Array.isArray(categoryEntry?.sounds) ? categoryEntry.sounds : [];

  const candidates = [];
  for (const sound of sounds) {
    if (!sound || typeof sound.file !== "string") {
      continue;
    }

    const rel = sanitizeRelativePath(sound.file);
    if (!rel) {
      continue;
    }

    candidates.push({ file: rel, label: typeof sound.label === "string" ? sound.label : "" });
  }

  if (candidates.length === 0) {
    return undefined;
  }

  const last = state.lastPlayedFile[category] || "";
  const pool = candidates.length <= 1 ? candidates : candidates.filter((entry) => entry.file !== last);
  const selected = pool[Math.floor(Math.random() * pool.length)] || candidates[0];
  state.lastPlayedFile[category] = selected.file;
  return selected;
}

function playSound(soundPath, volume) {
  if (!fs.existsSync(soundPath)) {
    return false;
  }

  const clampedVolume = clampVolume(volume);

  if (process.platform === "darwin") {
    return runDetached("afplay", ["-v", String(clampedVolume), soundPath]);
  }

  if (process.platform === "linux") {
    if (commandExists("pw-play")) {
      return runDetached("pw-play", ["--volume", String(clampedVolume), soundPath]);
    }

    if (commandExists("paplay")) {
      const pulseVolume = String(Math.round(clampedVolume * 65536));
      return runDetached("paplay", ["--volume", pulseVolume, soundPath]);
    }

    if (commandExists("ffplay")) {
      const ffplayVolume = String(Math.round(clampedVolume * 100));
      return runDetached("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", "-volume", ffplayVolume, soundPath]);
    }

    if (commandExists("mpv")) {
      const mpvVolume = `--volume=${Math.round(clampedVolume * 100)}`;
      return runDetached("mpv", ["--no-video", mpvVolume, soundPath]);
    }

    if (commandExists("aplay")) {
      return runDetached("aplay", [soundPath]);
    }

    return false;
  }

  if (process.platform === "win32") {
    const windowsPath = path.resolve(soundPath).replace(/\\/g, "\\\\");
    const script = [
      "Add-Type -AssemblyName PresentationCore",
      "$p = New-Object System.Windows.Media.MediaPlayer",
      `$p.Open([Uri]::new('file:///${windowsPath}'))`,
      `$p.Volume = ${clampedVolume}`,
      "Start-Sleep -Milliseconds 150",
      "$p.Play()",
      "Start-Sleep -Seconds 5",
      "$p.Close()",
    ].join("; ");

    return runDetached("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
  }

  return false;
}

function createOutput() {
  return { continue: true };
}

async function main() {
  const hookInput = await readStdinJson();
  const config = { ...DEFAULT_CONFIG, ...safeReadJson(CONFIG_PATH, {}) };
  config.categories = { ...DEFAULT_CONFIG.categories, ...(config.categories || {}) };
  config.labels = { ...DEFAULT_CONFIG.labels, ...(config.labels || {}) };

  const state = safeReadJson(STATE_PATH, {
    lastPlayedLabel: {},
    lastPlayedFile: {},
    promptTimestamps: [],
  });

  state.lastPlayedLabel = state.lastPlayedLabel || {};
  state.lastPlayedFile = state.lastPlayedFile || {};
  state.promptTimestamps = state.promptTimestamps || [];

  const output = createOutput();
  const hookEventName = String(hookInput.hookEventName || hookInput.hook_event_name || "");

  if (hookEventName === "PreToolUse") {
    output.hookSpecificOutput = {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Default allow from peon-ping hook.",
    };
  }

  let category = "";
  let extraMessage = "";

  if (hookEventName === "SessionStart") {
    category = "session.start";
  } else if (hookEventName === "UserPromptSubmit") {
    category = checkSpam(state, config) ? "user.spam" : "task.acknowledge";
  } else if (hookEventName === "Stop") {
    category = "task.complete";
  } else if (hookEventName === "SubagentStart") {
    category = "task.acknowledge";
  } else if (hookEventName === "SubagentStop") {
    category = "task.complete";
  } else if (hookEventName === "PostToolUse") {
    const responsePayload = hookInput.tool_response;
    if (containsPattern(responsePayload, ["rate\\s*limit", "too\\s*many\\s*requests", "quota"])) {
      category = "resource.limit";
    } else if (containsPattern(responsePayload, ["error", "failed", "exception", "traceback"])) {
      category = "task.error";
    }
  } else if (hookEventName === "PreToolUse") {
    const patterns = Array.isArray(config.dangerousCommandPatterns)
      ? config.dangerousCommandPatterns
      : DEFAULT_CONFIG.dangerousCommandPatterns;

    if (containsPattern(hookInput.tool_input, patterns)) {
      category = "input.required";
      extraMessage = "Potentially destructive tool input detected.";
      output.hookSpecificOutput = {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Potentially destructive command detected by peon-ping policy.",
        additionalContext: "Review command intent before approving tool execution.",
      };
    }
  }

  if (config.enabled && category && config.categories[category] !== false) {
    const packContext = getPackContext(config);
    const fallbackLabel = pickLabel(category, config, state);

    let playedAudio = false;
    let notificationMessage = fallbackLabel;

    if (packContext) {
      const picked = pickSound(category, packContext.manifest, state);
      if (picked) {
        const fullSoundPath = path.join(packContext.packDir, ...picked.file.split("/"));
        playedAudio = playSound(fullSoundPath, config.volume);
        if (picked.label) {
          notificationMessage = picked.label;
        }
      }
    }

    if (!playedAudio && config.bell) {
      ringBell();
    }

    if (config.desktopNotifications) {
      const message = extraMessage ? `${notificationMessage} ${extraMessage}` : notificationMessage;
      sendDesktopNotification("Peon Ping", message);
    }
  }

  safeWriteJson(STATE_PATH, state);
  process.stdout.write(JSON.stringify(output));
}

main().catch(() => {
  process.stdout.write(JSON.stringify(createOutput()));
});