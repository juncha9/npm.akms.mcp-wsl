import { PACKAGE_NAME, SERVER_NAME, SINGLE_HOST_ENV, TRUTHY_ENV_VALUES } from "@/_defs";
import type { HostSetupAnswers, McpServerEntry } from "@/_types";

/**
 * The variables the form owns. Anything else under `WSL_*` (`WSL_NAME`, `WSL_CWD`,
 * `WSL_ALLOW_SUDO`, allow-lists, timeouts, …) is hand-edited and survives an edit
 * untouched — see `extraEnv`.
 */
const MANAGED_ENV_NAMES: string[] = [
    SINGLE_HOST_ENV.DISTRO,
    SINGLE_HOST_ENV.USER,
    SINGLE_HOST_ENV.DESCRIPTION,
    SINGLE_HOST_ENV.READONLY,
    SINGLE_HOST_ENV.ALLOW_WINDOWS,
    SINGLE_HOST_ENV.ALLOWED_PATHS,
];

/**
 * How the client launches the server. The package is Windows-only, and there `npx` is a
 * `.cmd` shim that a client spawning without a shell cannot start, so it goes behind
 * `cmd /c` — the wrapper Claude Code's own docs prescribe for npx servers on Windows.
 */
const LAUNCH_COMMAND = "cmd";
const LAUNCH_ARGS = ["/c", "npx", "-y", PACKAGE_NAME];

/**
 * Valid MCP server names. The name becomes part of every tool name the agent sees
 * (`mcp__<name>__wsl_exec`), and tool names allow only these characters.
 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;

/** True for entries that launch this package — the only ones the `setup` command manages. */
export function isOurEntry(entry: McpServerEntry): boolean {
    if (entry.args.includes(PACKAGE_NAME) == true) {
        return true;
    }

    const commandBase = entry.command.replace(/\\/g, "/").split("/").pop() ?? "";
    return commandBase === SERVER_NAME || commandBase.startsWith(`${SERVER_NAME}.`) == true;
}

/**
 * Renders the answers as an entry. A value equal to the server's default is left out, so
 * the result reads like the README's examples rather than a dump of every variable.
 */
export function answersToEntry(answers: HostSetupAnswers): McpServerEntry {
    const env: Record<string, string> = {};

    env[SINGLE_HOST_ENV.DISTRO] = answers.distro;
    if (answers.username != null && answers.username !== "") {
        env[SINGLE_HOST_ENV.USER] = answers.username;
    }

    if (answers.description != null && answers.description !== "") {
        env[SINGLE_HOST_ENV.DESCRIPTION] = answers.description;
    }

    if (answers.readonly == true) {
        env[SINGLE_HOST_ENV.READONLY] = "true";
    }

    if (answers.allowWindows == true) {
        env[SINGLE_HOST_ENV.ALLOW_WINDOWS] = "true";
    }

    if (answers.allowedPaths.length > 0) {
        env[SINGLE_HOST_ENV.ALLOWED_PATHS] = answers.allowedPaths.join(",");
    }

    for (const [name, value] of Object.entries(answers.extraEnv)) {
        if (MANAGED_ENV_NAMES.includes(name) == true) {
            continue;
        }

        env[name] = value;
    }

    return {
        command: LAUNCH_COMMAND,
        args: [...LAUNCH_ARGS],
        env: env,
    };
}

function isTruthy(value: string | undefined): boolean {
    if (value == null) {
        return false;
    }

    return TRUTHY_ENV_VALUES.includes(value.trim().toLowerCase());
}

/** Reads an existing entry back into answers so the form can pre-fill an edit. */
export function entryToAnswers(name: string, entry: McpServerEntry): HostSetupAnswers {
    const env = entry.env;

    let allowedPaths: string[] = [];
    const allowedPathsValue = env[SINGLE_HOST_ENV.ALLOWED_PATHS];
    if (allowedPathsValue != null) {
        allowedPaths = allowedPathsValue.split(",").map((item) => item.trim()).filter((item) => item !== "");
    }

    const extraEnv: Record<string, string> = {};
    for (const [variable, value] of Object.entries(env)) {
        if (MANAGED_ENV_NAMES.includes(variable) == false) {
            extraEnv[variable] = value;
        }
    }

    return {
        name: name,
        distro: env[SINGLE_HOST_ENV.DISTRO] ?? "",
        username: env[SINGLE_HOST_ENV.USER],
        description: env[SINGLE_HOST_ENV.DESCRIPTION],
        readonly: isTruthy(env[SINGLE_HOST_ENV.READONLY]),
        allowWindows: isTruthy(env[SINGLE_HOST_ENV.ALLOW_WINDOWS]),
        allowedPaths: allowedPaths,
        extraEnv: extraEnv,
    };
}

/** One row of the menu: `user@distro`, and the policy settings in force. */
export function summarizeEntry(entry: McpServerEntry): { endpoint: string; notes: string } {
    const env = entry.env;
    const distro = env[SINGLE_HOST_ENV.DISTRO] ?? "?";
    const username = env[SINGLE_HOST_ENV.USER];

    let endpoint = distro;
    const notes: string[] = [];
    if (username != null) {
        endpoint = `${username}@${distro}`;
    }
    else {
        notes.push("default user");
    }

    if (isTruthy(env[SINGLE_HOST_ENV.READONLY]) == true) {
        notes.push("readonly");
    }
    if (isTruthy(env[SINGLE_HOST_ENV.ALLOW_WINDOWS]) == true) {
        notes.push("windows open");
    }
    if (env[SINGLE_HOST_ENV.ALLOWED_PATHS] != null) {
        notes.push(`paths ${env[SINGLE_HOST_ENV.ALLOWED_PATHS]}`);
    }

    return {
        endpoint: endpoint,
        notes: notes.join(", "),
    };
}
