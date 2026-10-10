import os from "node:os";
import path from "node:path";

import type { ConfigTarget } from "@/_types";

import { createClaudeCodeTarget } from "./claude-code";
import { createCodexTarget } from "./codex";
import { createJsonFileTarget } from "./json-file";

export { formatClaudeAddCommand } from "./claude-code";
export { renderMcpServerTable } from "./toml-subset";

/** Every supported client, detected ones first so the first entry is the sensible default. */
export function listConfigTargets(): ConfigTarget[] {
    // Windows only, like the package — `%APPDATA%` is where Claude Desktop keeps its config there.
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    const claudeDesktopConfigPath = path.join(appData, "Claude", "claude_desktop_config.json");

    const targets: ConfigTarget[] = [
        createClaudeCodeTarget(),
        createCodexTarget(),
        createJsonFileTarget({ id: "claude-desktop", label: "Claude Desktop", filePath: claudeDesktopConfigPath }),
        createJsonFileTarget({ id: "cursor", label: "Cursor", filePath: path.join(os.homedir(), ".cursor", "mcp.json") }),
    ];

    const detected = targets.filter((target) => target.detected == true);
    const others = targets.filter((target) => target.detected == false);
    return [...detected, ...others];
}
