/** One `mcpServers` entry as every MCP client spells it: a stdio command plus its env block. */
export interface McpServerEntry {
    command: string;
    args: string[];
    env: Record<string, string>;
}

/**
 * What the `setup` form collects for one distro entry. `answersToEntry` turns it into
 * `WSL_*` variables and `entryToAnswers` reads an existing entry back, so an edit pre-fills.
 */
export interface HostSetupAnswers {
    /** The entry key — the name the agent sees in its tool list. */
    name: string;
    /** Distro name as `wsl -l -q` prints it. */
    distro: string;
    /** Linux user; absent means the distro's default user. */
    username?: string;
    description?: string;
    readonly: boolean;
    allowWindows: boolean;
    allowedPaths: string[];
    /** `WSL_*` variables the form does not show, carried through an edit untouched. */
    extraEnv: Record<string, string>;
}

export type ConfigTargetId = "claude-code" | "claude-desktop" | "codex" | "cursor";

export interface ConfigWriteResult {
    status: "written" | "unavailable";
    /** Where it went, or why it could not and what to do instead. */
    detail: string;
}

/** One MCP client's config: where its entries live and how to change them. */
export interface ConfigTarget {
    id: ConfigTargetId;
    label: string;
    /** The config file, as shown to the user. */
    location: string;
    /** True when the client's CLI is on PATH or its config file exists. */
    detected: boolean;
    /**
     * Every `mcpServers` entry in the file, ours or not; entries this package cannot parse
     * are skipped.
     *
     * @throws {Error} If the file exists but cannot be parsed.
     */
    readEntries(): Record<string, McpServerEntry>;
    writeEntry(name: string, entry: McpServerEntry): ConfigWriteResult;
    removeEntry(name: string): ConfigWriteResult;
}
