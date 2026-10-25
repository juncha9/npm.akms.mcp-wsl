import { SERVER_VERSION } from "@/_defs";
import type { Registry } from "../registration/registry";
import { ManagedSession } from "../registration/menu";
import type { ManagementMode } from "../registration/menu";
import type { Readable, Writable } from "node:stream";

import type { ConfigTarget, ConfigWriteResult, HostSetupAnswers, McpServerEntry, WslDistroListing } from "@/_types";
import { listDistros } from "@/modules/wsl";

import { profileFromEnv, runDistroCheck } from "./connection-check";
import { copyEntryToClient } from "./copy-entry";
import { answersToEntry, entryToAnswers, isOurEntry, summarizeEntry } from "./entry";
import { runHostForm } from "./host-form";
import { PromptBackError, PromptClosedError, Prompter, displayWidth } from "./prompter";
import type { SelectItem } from "./prompter";
import { formatClaudeAddCommand, listConfigTargets, renderMcpServerTable } from "./targets";

export { runDistroCheck } from "./connection-check";

/** Prefix of an entry row's select value, so an entry named like an action can't collide with it. */
const HOST_VALUE_PREFIX = "host:";

export interface ConfigCommandOptions {
    input: Readable;
    output: Writable;
    /** Supported clients; tests pass their own so nothing under the real home is touched. */
    targets?: ConfigTarget[];
    /** Client to open on; defaults to the first detected one. */
    targetId?: string;
    registryPath?: string;
    mode?: ManagementMode;
    runtimeOptions?: Registry["runtimeOptions"]; management?: ManagedSession;
    /** The distros offered in the form; tests pass their own so the flow does not depend on this machine. */
    listDistros?: () => Promise<WslDistroListing[]>;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

/** The entry as it reads inside the target's own file — a TOML table for Codex, JSON otherwise. */
function formatForTarget(target: ConfigTarget, name: string, entry: McpServerEntry): string {
    if (target.id === "codex") {
        return renderMcpServerTable(name, entry);
    }

    return `"${name}": ${JSON.stringify(entry, null, 4)}\n`;
}

function indent(text: string): string {
    return text.replace(/\n$/, "").split("\n").map((line) => `    ${line}`).join("\n");
}

function reportWrite(prompter: Prompter, result: ConfigWriteResult, action: string): void {
    prompter.clearScreen();
    if (result.status === "written") {
        prompter.write(`  ${prompter.paint.success(action)} ${prompter.paint.dim(result.detail)}\n`);
        prompter.write(prompter.paint.dim("  Restart the client (or reconnect it from its MCP menu) to pick up the change.\n\n"));
        return;
    }

    prompter.write(`  Not ${action.toLowerCase()}: ${result.detail}\n\n`);
}

/**
 * Add (no `existingName`) or edit one distro entry: the settings form → preview → write.
 * A renamed entry is written under the new name first, then the old name removed, so a
 * failed write never leaves the distro unregistered.
 */
async function addOrEditHost(
    prompter: Prompter,
    output: Writable,
    target: ConfigTarget,
    entries: Record<string, McpServerEntry>,
    readDistroListing: () => Promise<WslDistroListing[]>,
    existingName?: string,
    management?: ManagedSession,
): Promise<void> {
    let existing: HostSetupAnswers | undefined;
    if (existingName != null) {
        existing = entryToAnswers(existingName, entries[existingName]);
    }

    // Read per add / edit rather than once: a distro installed while the manager is open
    // should be offered.
    let distros: WslDistroListing[] = [];
    try {
        distros = await readDistroListing();
    }
    catch (ex) {
        output.write(`  Could not list the installed distros: ${errorMessage(ex)}\n`);
        await prompter.acknowledge();
    }

    let answers = await runHostForm(prompter, output, {
        existing: existing,
        takenNames: Object.keys(entries),
        destination: target.label,
        distros: distros,
    });
    if (answers == null) {
        output.write("  Cancelled — nothing was written.\n\n");
        await prompter.acknowledge();
        return;
    }

    let entry = answersToEntry(answers);
    entry = target.prepareEntry?.(answers.name, entry, existingName) ?? entry;
    for (;;) {
        prompter.clearScreen();
        output.write(`\n  ${prompter.paint.dim(`This goes into ${target.location}:`)}\n\n`);
        output.write(`${indent(formatForTarget(target, answers.name, entry))}\n\n`);

        let confirmed: boolean;
        try {
            confirmed = await prompter.askYesNo(target.id === "registered" ? "Save and apply to all registered services?" : "Write it?", true);
        }
        catch (ex) {
            if (ex instanceof PromptBackError == false) {
                throw ex;
            }

            // Esc at the preview reopens the form on the same values, so one more change
            // does not mean filling everything in again.
            const revised = await runHostForm(prompter, output, {
                existing: answers,
                takenNames: Object.keys(entries),
                destination: target.label,
                distros: distros,
            });
            if (revised == null) {
                output.write("  Cancelled — nothing was written.\n\n");
                await prompter.acknowledge();
                return;
            }

            answers = revised;
            entry = answersToEntry(answers);
            entry = target.prepareEntry?.(answers.name, entry, existingName) ?? entry;
            continue;
        }

        if (confirmed == false) {
            output.write("  Not written. Pick the entry and choose Print to get it ready to paste.\n\n");
            await prompter.acknowledge();
            return;
        }

        break;
    }

    const written = (existingName && existingName !== answers.name && target.renameEntry ? target.renameEntry(existingName, answers.name, entry) : target.writeEntry(answers.name, entry));
    reportWrite(prompter, written, "Written");

    if (written.status === "written" && existingName != null && existingName !== answers.name && !target.renameEntry) {
        const removed = target.removeEntry(existingName);
        if (removed.status === "unavailable") {
            output.write(`  The old name ${existingName} is still there: ${removed.detail}\n\n`);
        }
    }
    if(written.status === "written") await management?.checkSaved(prompter, answers.name, existingName ? entries[existingName] : undefined);
    await prompter.acknowledge();
}

/** Every form the entry can be pasted in — this view exists to be copied. */
function printHost(prompter: Prompter, name: string, entry: McpServerEntry): void {
    prompter.write(`\n  ${prompter.paint.dim("JSON — Claude Desktop, Cursor, .mcp.json (inside \"mcpServers\"):")}\n\n`);
    prompter.write(`${indent(`"${name}": ${JSON.stringify(entry, null, 4)}`)}\n\n`);
    prompter.write(`  ${prompter.paint.dim("TOML — Codex (~/.codex/config.toml):")}\n\n`);
    prompter.write(`${indent(renderMcpServerTable(name, entry))}\n\n`);
    prompter.write(`  ${prompter.paint.dim("Claude Code CLI (Git Bash):")}\n\n`);
    prompter.write(`${indent(formatClaudeAddCommand(name, entry))}\n\n`);
}

/** The entry rows of the main menu: name and `user@distro`, aligned into columns. */
function buildHostItems(names: string[], entries: Record<string, McpServerEntry>): SelectItem<string>[] {
    const nameWidth = Math.max(...names.map((name) => displayWidth(name)));
    const summaries = names.map((name) => summarizeEntry(entries[name]));
    const endpointWidth = Math.max(...summaries.map((summary) => displayWidth(summary.endpoint)));

    return names.map((name, index) => {
        const summary = summaries[index];
        return {
            value: `${HOST_VALUE_PREFIX}${name}`,
            key: name,
            label: `${name.padEnd(nameWidth)}  ${summary.endpoint.padEnd(endpointWidth)}`,
            hint: summary.notes,
        };
    });
}

/** What to do with one picked entry. Esc goes back to the list. */
async function manageHost(
    prompter: Prompter,
    output: Writable,
    target: ConfigTarget,
    targets: ConfigTarget[],
    entries: Record<string, McpServerEntry>,
    readDistroListing: () => Promise<WslDistroListing[]>,
    name: string,
    management?: ManagedSession,
): Promise<void> {
    const action = await prompter.select(
        name,
        [
            { value: "edit", key: "e", label: "Edit", hint: "open its settings" },
            { value: "check", key: "c", label: "Check the distro", hint: "run 'id' in it as the user now" },
            { value: "print", key: "p", label: "Print the entry", hint: "JSON, Codex TOML and a claude command, ready to paste" },
            ...targets.some((candidate) => candidate.id !== target.id)
                ? [{ value: "copy", key: "o", label: "Copy to another client", hint: "keep this entry and copy its settings" }]
                : [],
            { value: "remove", key: "r", label: "Remove", hint: `from ${target.label}` },
            { separator: true },
            { value: "back", key: "b", label: "Back" },
        ],
        { defaultValue: "edit", cancelValue: "back" },
    );
    prompter.clearScreen();

    if(action === "edit") {
        if(management && !await management.prepareRuntime(prompter, entries[name])) return;
        await addOrEditHost(prompter, output, target, entries, readDistroListing, name, management);
        return;
    }

    if (action === "check") {
        output.write("\n");
        const profile = profileFromEnv(output, entries[name].env);
        if (profile != null) {
            await runDistroCheck(profile, output);
        }
        output.write("\n");
        await prompter.pause();
        return;
    }

    if (action === "print") {
        printHost(prompter, name, entries[name]);
        await prompter.acknowledge();
        return;
    }

    if (action === "copy") {
        await copyEntryToClient(prompter, target, targets, name, entries[name]);
        await prompter.acknowledge();
        return;
    }

    if (action === "remove") {
        const remove = await prompter.askYesNo(`Remove ${name} from ${target.location}?`, false);
        if (remove == true) {
            reportWrite(prompter, target.removeEntry(name), "Removed");
            await prompter.acknowledge();
        }
    }
}

/**
 * `akms-mcp-wsl config` — an interactive manager for the WSL distros registered in an MCP
 * client's config. The entries themselves are the menu: pick one to edit, check, copy, print or
 * remove it, or pick an action below them. The `WSL_*` names never have to be typed.
 *
 * @returns Process exit code.
 */
export async function runTargetConfigCommand(options: ConfigCommandOptions): Promise<number> {
    const { input, output } = options;
    const targets = options.targets ?? listConfigTargets();
    const readDistroListing = options.listDistros ?? listDistros;

    let target = targets[0];
    if (options.targetId != null) {
        const requested = targets.find((candidate) => candidate.id === options.targetId);
        if (requested == null) {
            output.write(`Unknown client "${options.targetId}". One of: ${targets.map((candidate) => candidate.id).join(", ")}\n`);
            return 1;
        }
        target = requested;
    }

    const prompter = new Prompter(input, output);
    const paint = prompter.paint;

    try {
        if(options.management && !await options.management.initialize(prompter)) return 0;
        for(;;) {
            let entries: Record<string, McpServerEntry> = {};
            let names: string[] = [];
            let readError: string | null = null;

            try {
                entries = target.readEntries();
                names = Object.keys(entries).filter((name) => isOurEntry(entries[name]) == true);
            }
            catch (ex) {
                readError = errorMessage(ex);
            }

            // (1) Where we are
            prompter.clearScreen();
            if(options.management) {
                output.write(paint.bold("WSL connections") + "\n");
                options.management.writeStatus(prompter);
            } else output.write(`\n${paint.bold(target.label)}  ${paint.dim(target.location)}\n`);
            if (readError != null) {
                output.write(`  Cannot read it: ${readError}\n  Fix the file by hand, or switch to another client.\n`);
            }
            else {
                const otherCount = Object.keys(entries).length - names.length;
                if (otherCount > 0) {
                    output.write(paint.dim(`  ${otherCount} other MCP server(s) in this file are not managed here.\n`));
                }
            }
            output.write("\n");

            // (2) The entries are the menu; actions follow them
            const items: SelectItem<string>[] = [];
            if (names.length > 0) {
                items.push(...buildHostItems(names, entries));
                items.push({ separator: true });
            }
            if (readError == null) {
                items.push({ value: "add", key: "a", label: "Add a distro" });
            }

            const otherTargets = targets.filter((candidate) => candidate.id !== target.id);
            if (otherTargets.length > 0) {
                const detectedOthers = otherTargets.filter((candidate) => candidate.detected == true).map((candidate) => candidate.label);
                let switchHint = "";
                if (detectedOthers.length > 0) {
                    switchHint = `also found: ${detectedOthers.join(", ")}`;
                }
                items.push({ value: "switch", key: "t", label: "Switch client", hint: switchHint });
            }
            if(options.management) { options.management.decorate(items); items.push(...options.management.items()); }
            items.push({ value: "quit", key: "q", label: "Quit" });

            let question = "No WSL distros here yet";
            if (names.length === 1) {
                question = "1 WSL entry — pick it to manage it";
            }
            else if (names.length > 1) {
                question = `${names.length} WSL entries — pick one to manage it`;
            }

            let defaultValue = "add";
            if (names.length > 0) {
                defaultValue = `${HOST_VALUE_PREFIX}${names[0]}`;
            }

            const picked = await prompter.select(question, items, { defaultValue: defaultValue, cancelValue: "quit" });

            if (picked === "quit") {
                return 0;
            }

            prompter.clearScreen();
            if(options.management && await options.management.handle(picked, prompter)) continue;

            if(picked === "switch") {
                const switched = await prompter.select(
                    "Which client?",
                    targets.map((candidate) => {
                        let hint = candidate.location;
                        if (candidate.detected == false) {
                            hint += " · not found on this machine";
                        }
                        return { value: candidate.id, label: candidate.label, hint: hint };
                    }),
                    { defaultValue: target.id, cancelValue: target.id },
                );
                target = targets.find((candidate) => candidate.id === switched) ?? target;
                continue;
            }

            // (3) Act — a failure is reported and the menu comes back, rather than exiting
            try {
                if (picked === "add") {
                    await addOrEditHost(prompter, output, target, entries, readDistroListing, undefined, options.management);
                    continue;
                }

                if (picked.startsWith(HOST_VALUE_PREFIX) == true) {
                    await manageHost(prompter, output, target, targets, entries, readDistroListing, picked.slice(HOST_VALUE_PREFIX.length), options.management);
                }
            }
            catch (ex) {
                if (ex instanceof PromptClosedError) {
                    throw ex;
                }
                // Esc in a question the action asked (remove it?) means "no, and back to the
                // list" — nothing to report.
                if (ex instanceof PromptBackError) {
                    continue;
                }
                output.write(`  Failed: ${errorMessage(ex)}\n\n`);
                await prompter.acknowledge();
            }
        }
    }
    catch (ex) {
        // Input ending (Ctrl+C, Ctrl+D, a piped script running out) is a way to leave, not a crash.
        if (ex instanceof PromptClosedError) {
            output.write("\n");
            return 0;
        }
        throw ex;
    }
    finally {
        prompter.close();
    }
}

/** Independent registration and shared connection management; never invokes @akms/mcp. */
export async function runConfigCommand(options: ConfigCommandOptions): Promise<number> {
    const management = new ManagedSession({ kind: "wsl", version: SERVER_VERSION, targets: options.targets ?? listConfigTargets(), registryPath: options.registryPath, mode: options.mode, targetId: options.targetId, runtimeOptions: options.runtimeOptions });
    return runTargetConfigCommand({ ...options, targets: [management.target], targetId: undefined, management });
}
