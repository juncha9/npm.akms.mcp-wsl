#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { LOG_LEVEL_ENV, SERVER_NAME, SERVER_VERSION, SINGLE_HOST_ENV } from "@/_defs";
import { $logger } from "@/_libs";
import type { WslHostProfile } from "@/_types";
import { runDistroCheck, runConfigCommand } from "@/modules/manage";
import { createWslMcpServer } from "@/server";

/** `@akms/mcp-ssh`'s guard logs through its own logger; keep the two thresholds aligned. */
const SSH_LOG_LEVEL_ENV = "SSH_MCP_LOG_LEVEL";

interface CliArguments {
    showHelp: boolean;
    showVersion: boolean;
    checkOnly: boolean;
    /** `config` as the first argument opens the distro manager instead of the server. */
    configMode: boolean;
    /** `--target <id>` — the client `config` opens on. */
    targetId?: string;
}

function parseArguments(argv: string[]): CliArguments {
    const parsed: CliArguments = { showHelp: false, showVersion: false, checkOnly: false, configMode: false };

    let rest = argv;
    if (argv[0] === "config") {
        parsed.configMode = true;
        rest = argv.slice(1);
    }

    for (let index = 0; index < rest.length; index += 1) {
        const argument = rest[index];

        if (argument === "--target") {
            parsed.targetId = rest[index + 1];
            index += 1;
            continue;
        }

        if (argument.startsWith("--target=") == true) {
            parsed.targetId = argument.slice("--target=".length);
            continue;
        }

        if (argument === "--help" || argument === "-h") {
            parsed.showHelp = true;
            continue;
        }

        if (argument === "--version" || argument === "-v") {
            parsed.showVersion = true;
            continue;
        }

        if (argument === "--check") {
            parsed.checkOnly = true;
            continue;
        }
    }

    return parsed;
}

const HELP_TEXT = [
    `${SERVER_NAME} ${SERVER_VERSION} — MCP server for command execution and file transfer in a WSL distro (via wsl.exe)`,
    "",
    "Usage:",
    "  akms-mcp-wsl [--check]",
    "  akms-mcp-wsl config [--target <client>]",
    "",
    "Commands:",
    "  config               Manage the WSL distros registered in an MCP client's config —",
    "                       list, add, edit, remove, check, print. Asks plain questions,",
    "                       so the WSL_* names below never have to be typed.",
    "",
    "Options:",
    "      --check          Look up the configured distro, run 'id' in it, report the result, and exit.",
    "      --target <id>    config: claude-code | codex | claude-desktop | cursor",
    "                       (default: the first one installed)",
    "  -v, --version        Print the version and exit",
    "  -h, --help           Print this help and exit",
    "",
    "Environment — one server entry per distro and user, set in the MCP client's env block:",
    `  ${SINGLE_HOST_ENV.DISTRO}          Distro name as 'wsl -l -q' prints it  (required)`,
    `  ${SINGLE_HOST_ENV.USER}            Linux user to run as; the distro default when unset`,
    `  ${SINGLE_HOST_ENV.NAME}            Alias shown to the model; defaults to the distro name`,
    `  ${SINGLE_HOST_ENV.DESCRIPTION}     Shown to the model — say what the distro is for`,
    `  ${SINGLE_HOST_ENV.CWD}             Directory new sessions start in`,
    `  ${SINGLE_HOST_ENV.READONLY}        Reject write commands, redirections, uploads  (default false)`,
    `  ${SINGLE_HOST_ENV.ALLOW_SUDO}      Allow sudo / su / doas  (default true)`,
    `  ${SINGLE_HOST_ENV.ALLOW_WINDOWS}   Allow interop .exe and writes under /mnt/<drive>/  (default false)`,
    `  ${SINGLE_HOST_ENV.ALLOW_COMMANDS}  Comma-separated allow-list of binaries`,
    `  ${SINGLE_HOST_ENV.DENY_PATTERNS}   Comma-separated extra deny regexes`,
    `  ${SINGLE_HOST_ENV.ALLOWED_PATHS}   Comma-separated path prefixes the file tools may touch`,
    `  ${SINGLE_HOST_ENV.EXEC_TIMEOUT_MS} / ${SINGLE_HOST_ENV.MAX_OUTPUT_CHARACTERS} / ${SINGLE_HOST_ENV.MAX_READ_FILE_BYTES}`,
    `  ${LOG_LEVEL_ENV}  silent | debug | info | warn | error  (default: info, written to stderr)`,
    "",
    "Windows only — wsl.exe is the transport. The server speaks MCP over stdio; run it from an MCP client, not interactively.",
].join("\n");

/**
 * `--check`: looks the configured distro up and runs `id` in it. The report itself is
 * shared with `config`, so a distro that passes the configuration check passes `--check`.
 * Writes to stdout because this mode is not an MCP session.
 *
 * @returns Process exit code: 0 when the distro answers.
 */
async function runCheckCommand(profile: WslHostProfile | null): Promise<number> {
    if (profile == null) {
        process.stdout.write(`No WSL distro is registered — set ${SINGLE_HOST_ENV.DISTRO} (and optionally ${SINGLE_HOST_ENV.USER}), or run: akms-mcp-wsl config\n`);
        return 1;
    }

    const answered = await runDistroCheck(profile, process.stdout);
    if (answered == true) {
        return 0;
    }

    return 1;
}

async function main(): Promise<void> {
    const _logger = $logger.child({ context: "cli" });

    if (process.argv[2] === "setup") {
        process.stderr.write("The setup command has been removed. Use akms-mcp-wsl config.\n");
        process.exitCode = 1;
        return;
    }

    const cliArguments = parseArguments(process.argv.slice(2));

    if (cliArguments.showHelp == true) {
        process.stderr.write(`${HELP_TEXT}\n`);
        return;
    }

    if (cliArguments.showVersion == true) {
        process.stderr.write(`${SERVER_VERSION}\n`);
        return;
    }

    // `--check` prints a report a person reads, and `config` is a terminal UI; interleaved
    // log lines make the first unreadable and land in the middle of the second's prompts.
    // Everything worth seeing — a missing distro, a rejected `id` — is in the report itself.
    // An explicit level still wins, so `WSL_MCP_LOG_LEVEL=debug --check` stays available.
    const printsForPerson = cliArguments.checkOnly == true || cliArguments.configMode == true;
    if (printsForPerson == true && process.env[LOG_LEVEL_ENV] == null) {
        process.env[LOG_LEVEL_ENV] = "silent";
    }

    if (process.env[SSH_LOG_LEVEL_ENV] == null && process.env[LOG_LEVEL_ENV] != null) {
        process.env[SSH_LOG_LEVEL_ENV] = process.env[LOG_LEVEL_ENV];
    }

    if (cliArguments.configMode == true) {
        const exitCode = await runConfigCommand({
            input: process.stdin,
            output: process.stdout,
            targetId: cliArguments.targetId,
        });
        process.exit(exitCode);
    }

    const instance = createWslMcpServer();

    if (cliArguments.checkOnly == true) {
        const exitCode = await runCheckCommand(instance.profile);
        instance.shutdown();
        process.exit(exitCode);
    }

    let shuttingDown = false;
    const shutdown = (signal: string): void => {
        if (shuttingDown == true) {
            return;
        }
        shuttingDown = true;

        _logger.info("shutting down", { signal: signal });
        instance.shutdown();
        void instance.server.close().finally(() => {
            process.exit(0);
        });
    };

    process.on("SIGINT", () => {
        shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
        shutdown("SIGTERM");
    });

    // stdin closing means the MCP client is gone; without this the process would linger.
    process.stdin.on("close", () => {
        shutdown("stdin-close");
    });

    const transport = new StdioServerTransport();
    await instance.server.connect(transport);

    _logger.info("mcp server ready on stdio", {
        server: SERVER_NAME,
        version: SERVER_VERSION,
        profile: instance.profile?.name ?? null,
    });
}

main().catch((error: unknown) => {
    const _logger = $logger.child({ context: "cli" });
    _logger.error(error, "mcp server failed to start");

    // Printed independently of the logger: `--check` silences it, and a setup mistake
    // that exits 1 with no explanation is the worst possible first-run experience.
    let detail = String(error);
    if (error instanceof Error) {
        detail = error.message;
    }

    process.stderr.write(`akms-mcp-wsl: ${detail}\n`);
    process.exit(1);
});
