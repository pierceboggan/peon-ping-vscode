import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as vscode from "vscode";

const HOOKS_DIR = ".github/hooks";
const HOOKS_FILE = "peon-ping.json";
const SCRIPT_FILE = "peon-ping-hook.js";
const CONFIG_FILE = "peon-ping.config.json";
const PACKS_DIR = "packs";

const REGISTRY_URL = "https://peonping.github.io/registry/index.json";
const DEFAULT_PACK = "peon";

type RegistryPack = {
  name: string;
  source_repo: string;
  source_ref: string;
  source_path: string;
};

type RegistryResponse = {
  packs?: RegistryPack[];
};

type ManifestSound = {
  file?: string;
};

type ManifestCategory = {
  sounds?: ManifestSound[];
};

type OpenPeonManifest = {
  categories?: Record<string, ManifestCategory>;
};

function getWorkspaceRoot(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return response.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const text = await fetchText(url);
  return JSON.parse(text) as T;
}

async function downloadBinary(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  const content = await response.arrayBuffer();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, Buffer.from(content));
}

function sanitizeRelativePath(input: string): string | undefined {
  const normalized = path.posix.normalize(input.replace(/\\/g, "/")).replace(/^\/+/, "");
  if (normalized.length === 0 || normalized.startsWith("..")) {
    return undefined;
  }

  return normalized;
}

function buildRawBaseUrl(pack: RegistryPack): string {
  const trimmedSourcePath = pack.source_path === "."
    ? ""
    : pack.source_path.replace(/^\/+/, "").replace(/\/+$/, "");

  if (trimmedSourcePath.length === 0) {
    return `https://raw.githubusercontent.com/${pack.source_repo}/${pack.source_ref}`;
  }

  return `https://raw.githubusercontent.com/${pack.source_repo}/${pack.source_ref}/${trimmedSourcePath}`;
}

async function fetchManifestFromBase(baseUrl: string): Promise<{ fileName: string; manifest: OpenPeonManifest; rawText: string }> {
  const manifestCandidates = ["openpeon.json", "manifest.json"];

  for (const candidate of manifestCandidates) {
    const url = `${baseUrl}/${candidate}`;
    try {
      const rawText = await fetchText(url);
      const manifest = JSON.parse(rawText) as OpenPeonManifest;
      return { fileName: candidate, manifest, rawText };
    } catch {
    }
  }

  throw new Error(`Could not find openpeon.json or manifest.json under ${baseUrl}`);
}

async function syncPack(hooksDir: string, packName: string): Promise<{ count: number; packDir: string }> {
  const registry = await fetchJson<RegistryResponse>(REGISTRY_URL);
  const packs = Array.isArray(registry.packs) ? registry.packs : [];
  const pack = packs.find((item) => item.name === packName);

  if (!pack) {
    throw new Error(`Pack "${packName}" not found in registry.`);
  }

  const rawBaseUrl = buildRawBaseUrl(pack);
  const { fileName, manifest, rawText } = await fetchManifestFromBase(rawBaseUrl);
  const packDir = path.join(hooksDir, PACKS_DIR, pack.name);

  await fs.mkdir(packDir, { recursive: true });
  await fs.writeFile(path.join(packDir, fileName), `${rawText.trim()}\n`, "utf8");

  const categoryValues = Object.values(manifest.categories ?? {});
  const soundPaths = new Set<string>();

  for (const category of categoryValues) {
    const sounds = Array.isArray(category?.sounds) ? category.sounds : [];
    for (const sound of sounds) {
      const relativeFile = typeof sound?.file === "string" ? sound.file : "";
      const sanitized = sanitizeRelativePath(relativeFile);
      if (sanitized) {
        soundPaths.add(sanitized);
      }
    }
  }

  for (const relativeSoundPath of soundPaths) {
    const sourceUrl = `${rawBaseUrl}/${relativeSoundPath}`;
    const destinationPath = path.join(packDir, ...relativeSoundPath.split("/"));
    await downloadBinary(sourceUrl, destinationPath);
  }

  return { count: soundPaths.size, packDir };
}

function buildHooksRegistration(): string {
  const command = "node .github/hooks/peon-ping-hook.js";
  const payload = {
    hooks: {
      SessionStart: [{ type: "command", command, timeout: 10 }],
      UserPromptSubmit: [{ type: "command", command, timeout: 10 }],
      PreToolUse: [{ type: "command", command, timeout: 10 }],
      PostToolUse: [{ type: "command", command, timeout: 10 }],
      SubagentStart: [{ type: "command", command, timeout: 10 }],
      SubagentStop: [{ type: "command", command, timeout: 10 }],
      Stop: [{ type: "command", command, timeout: 10 }],
    },
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}

function buildDefaultConfig(): string {
  const payload = {
    enabled: true,
    bell: false,
    desktopNotifications: true,
    activePack: DEFAULT_PACK,
    packsDir: "./packs",
    volume: 0.5,
    startupAcknowledgeGraceSeconds: 4,
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

  return `${JSON.stringify(payload, null, 2)}\n`;
}

async function syncDefaultPack(workspaceRoot: string): Promise<void> {
  const hooksDir = path.join(workspaceRoot, HOOKS_DIR);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Peon Ping: Syncing \"${DEFAULT_PACK}\" audio pack`,
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Downloading registry and manifest" });
      const result = await syncPack(hooksDir, DEFAULT_PACK);
      progress.report({ message: `Downloaded ${result.count} audio files` });
    },
  );
}

async function installHooks(extensionPath: string): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage("Open a workspace folder before installing peon-ping hooks.");
    return;
  }

  const hooksDir = path.join(workspaceRoot, HOOKS_DIR);
  const hooksFilePath = path.join(hooksDir, HOOKS_FILE);
  const scriptPath = path.join(hooksDir, SCRIPT_FILE);
  const configPath = path.join(hooksDir, CONFIG_FILE);
  const bundledScriptPath = path.join(extensionPath, "resources", SCRIPT_FILE);

  if (!(await fileExists(bundledScriptPath))) {
    void vscode.window.showErrorMessage("Bundled peon-ping hook script was not found in extension resources.");
    return;
  }

  await fs.mkdir(hooksDir, { recursive: true });
  await fs.writeFile(hooksFilePath, buildHooksRegistration(), "utf8");
  await fs.copyFile(bundledScriptPath, scriptPath);

  if (!(await fileExists(configPath))) {
    await fs.writeFile(configPath, buildDefaultConfig(), "utf8");
  }

  try {
    await fs.chmod(scriptPath, 0o755);
  } catch {
  }

  try {
    await syncDefaultPack(workspaceRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    void vscode.window.showWarningMessage(`Peon Ping hooks installed, but audio pack download failed: ${message}`);
  }

  const openConfigAction = "Open Config";
  const result = await vscode.window.showInformationMessage(
    "Peon Ping Copilot hooks installed in .github/hooks with real audio pack files.",
    openConfigAction,
  );

  if (result === openConfigAction) {
    await openConfig(extensionPath);
  }
}

async function removeHooks(): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage("Open a workspace folder before removing peon-ping hooks.");
    return;
  }

  const hooksDir = path.join(workspaceRoot, HOOKS_DIR);
  const hooksFilePath = path.join(hooksDir, HOOKS_FILE);
  const scriptPath = path.join(hooksDir, SCRIPT_FILE);
  const statePath = path.join(hooksDir, ".peon-ping-state.json");

  await Promise.allSettled([
    fs.rm(hooksFilePath, { force: true }),
    fs.rm(scriptPath, { force: true }),
    fs.rm(statePath, { force: true }),
  ]);

  void vscode.window.showInformationMessage("Peon Ping Copilot hooks removed. Config and packs were preserved.");
}

async function openConfig(extensionPath: string): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage("Open a workspace folder before opening peon-ping config.");
    return;
  }

  const configPath = path.join(workspaceRoot, HOOKS_DIR, CONFIG_FILE);
  if (!(await fileExists(configPath))) {
    await installHooks(extensionPath);
  }

  const uri = vscode.Uri.file(configPath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function toggleEnabled(extensionPath: string): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage("Open a workspace folder before toggling peon-ping.");
    return;
  }

  const configPath = path.join(workspaceRoot, HOOKS_DIR, CONFIG_FILE);
  if (!(await fileExists(configPath))) {
    await installHooks(extensionPath);
  }

  let config: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(configPath, "utf8");
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    config = {};
  }

  const currentEnabled = config.enabled === true;
  config.enabled = !currentEnabled;
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  void vscode.window.showInformationMessage(`Peon Ping ${config.enabled === true ? "enabled" : "disabled"}.`);
}

async function handleSyncDefaultPack(extensionPath: string): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage("Open a workspace folder before syncing packs.");
    return;
  }

  const hooksDir = path.join(workspaceRoot, HOOKS_DIR);
  if (!(await fileExists(path.join(hooksDir, SCRIPT_FILE)))) {
    await installHooks(extensionPath);
    return;
  }

  try {
    await syncDefaultPack(workspaceRoot);
    void vscode.window.showInformationMessage(`Peon Ping default pack \"${DEFAULT_PACK}\" synced.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    void vscode.window.showErrorMessage(`Failed to sync default pack: ${message}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const extensionPath = context.extensionPath;

  context.subscriptions.push(
    vscode.commands.registerCommand("peonPing.installHooks", () => {
      void installHooks(extensionPath);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("peonPing.removeHooks", () => {
      void removeHooks();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("peonPing.openConfig", () => {
      void openConfig(extensionPath);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("peonPing.toggleEnabled", () => {
      void toggleEnabled(extensionPath);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("peonPing.syncDefaultPack", () => {
      void handleSyncDefaultPack(extensionPath);
    }),
  );
}

export function deactivate(): void {
}