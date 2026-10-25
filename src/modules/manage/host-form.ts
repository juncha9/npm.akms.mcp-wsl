import type { Writable } from "node:stream";

import type { HostSetupAnswers, WslDistroListing } from "@/_types";

import { profileFromEnv, runDistroCheck } from "./connection-check";
import { SERVER_NAME_PATTERN, answersToEntry } from "./entry";
import { PromptBackError } from "./prompter";
import type { Prompter, SelectChoice, SelectItem } from "./prompter";

/** The answer that clears an optional value, since Enter keeps the one shown. */
const CLEAR_ANSWER = "-";

/** Select value for "type a name instead". Not a name a distro could have. */
const OTHER_DISTRO = "\u0000other";

/** Column the values start at, past the longest setting name ("Windows access"). */
const FIELD_NAME_WIDTH = 16;

/** Shown in place of a value the entry cannot do without. */
const REQUIRED_MARK = "(required)";

type FieldId = "distro" | "user" | "name" | "description" | "readonly" | "windows" | "paths";

type FormAction = "test" | "save" | "cancel";

type FormValue = FieldId | FormAction;

/** Settings that flip on Enter; the cursor stays on them, so a second Enter flips back. */
const TOGGLE_FIELDS: FieldId[] = ["readonly", "windows"];

const FIELD_NAMES: Record<FieldId, string> = {
    "distro": "Distro",
    "user": "User",
    "name": "Server name",
    "description": "Description",
    "readonly": "Read-only",
    "windows": "Windows access",
    "paths": "File paths",
};

/** The form's working copy. */
interface FormState {
    answers: HostSetupAnswers;
    /** False while the server name still follows the distro and user. */
    nameTouched: boolean;
    lastTest: "never" | "ok" | "failed";
    /** The answers at the last successful test; Save offers a test when they differ. */
    testedSnapshot: string | null;
}

export interface HostFormOptions {
    /** The entry being edited; absent when adding one. */
    existing?: HostSetupAnswers;
    /** Every server name already in the file, ours or not. */
    takenNames: string[];
    /** Where Save writes to, as shown to the user. */
    destination: string;
    /** What `wsl -l -v` listed; empty when it could not be read. */
    distros: WslDistroListing[];
}

/** Matched case-insensitively, as `wsl -d` matches. */
function findListed(distros: WslDistroListing[], name: string): WslDistroListing | undefined {
    return distros.find((listing) => listing.name.toLowerCase() === name.toLowerCase());
}

/** Optional free text: Enter keeps `current`, `-` clears it. */
async function askOptional(prompter: Prompter, question: string, current: string | undefined): Promise<string | undefined> {
    const answer = await prompter.ask(question, current);
    if (answer === "" || answer === CLEAR_ANSWER) {
        return undefined;
    }

    return answer;
}

/**
 * Distro: the `wsl -l -v` rows as a list, plus "another name". A picked row is written as
 * wsl.exe spells it; a typed name that is not listed needs an explicit yes, since the server
 * would only say so at its first call.
 */
async function askDistro(prompter: Prompter, distros: WslDistroListing[], current: string | undefined): Promise<string> {
    let picked = OTHER_DISTRO;
    if (distros.length > 0 || current != null) {
        const items: SelectItem<string>[] = [];
        if (current != null && findListed(distros, current) == null) {
            items.push({ value: current, label: current, hint: "current · not in wsl -l -v" });
        }
        for (const listing of distros) {
            const hintParts = [listing.state, `WSL ${listing.wslVersion}`];
            if (listing.isDefault == true) {
                hintParts.push("default");
            }
            items.push({ value: listing.name, label: listing.name, hint: hintParts.join(" · ") });
        }
        items.push({ separator: true });
        items.push({ value: OTHER_DISTRO, key: "other", label: "Another name…" });

        let defaultValue = distros.find((listing) => listing.isDefault == true)?.name;
        if (current != null) {
            defaultValue = findListed(distros, current)?.name ?? current;
        }

        picked = await prompter.select("Distro", items, { defaultValue: defaultValue });
    }

    if (picked !== OTHER_DISTRO) {
        return picked;
    }

    for (;;) {
        const typed = await prompter.askRequired("Distro name (as 'wsl -l -q' prints it)");
        const listed = findListed(distros, typed);
        if (listed != null) {
            return listed.name;
        }

        prompter.write(`  ${typed} is not in 'wsl -l -v'.\n`);
        const useAnyway = await prompter.askYesNo("Use this name anyway?", false);
        if (useAnyway == true) {
            return typed;
        }
    }
}

/** `wsl_<distro>_<user>`, the README's naming: the user belongs in the name the agent sees. */
function deriveServerName(distro: string, username: string | undefined): string {
    const nameParts = ["wsl", distro];
    if (username != null) {
        nameParts.push(username);
    }

    return nameParts.join("_").replace(/[^A-Za-z0-9_-]+/g, "_").toLowerCase().slice(0, 48);
}

function snapshotOf(state: FormState): string {
    return JSON.stringify(state.answers);
}


/** Settings the entry cannot do without that are still empty, in display order. */
function missingFields(state: FormState): FieldId[] {
    // An empty name only happens while the distro is empty too — the name follows it — so
    // asking for "Distro" already covers it.
    if (state.answers.distro === "") {
        return ["distro"];
    }

    return [];
}

function fieldRow(id: FieldId, value: string, hint?: string): SelectChoice<FormValue> {
    return {
        value: id,
        key: id,
        label: `${FIELD_NAMES[id].padEnd(FIELD_NAME_WIDTH)}${value}`,
        hint: hint,
    };
}

/** The form: every setting with its current value, then the actions. */
function buildRows(state: FormState, destination: string): SelectItem<FormValue>[] {
    const { answers } = state;
    const rows: SelectItem<FormValue>[] = [];

    let distro = answers.distro;
    if (distro === "") {
        distro = REQUIRED_MARK;
    }
    rows.push(fieldRow("distro", distro));

    rows.push(fieldRow("user", answers.username ?? "distro default", "the Linux user commands run as"));

    let nameValue = answers.name;
    let nameHint = "what the agent sees";
    if (state.nameTouched == false) {
        nameHint = "follows the distro and user until you change it";
    }
    if (nameValue === "") {
        nameValue = "wsl_<distro>_<user>";
    }
    rows.push(fieldRow("name", nameValue, nameHint));

    rows.push(fieldRow("description", answers.description ?? "none", "shown to the agent"));

    let readonly = "no";
    if (answers.readonly == true) {
        readonly = "yes";
    }
    rows.push(fieldRow("readonly", readonly, "enter toggles"));

    let windows = "locked";
    if (answers.allowWindows == true) {
        windows = "open";
    }
    rows.push(fieldRow("windows", windows, "enter toggles · .exe through interop, writes under /mnt/<drive>/"));

    let paths = "anywhere";
    if (answers.allowedPaths.length > 0) {
        paths = answers.allowedPaths.join(", ");
    }
    rows.push(fieldRow("paths", paths, "where the file tools may read and write"));

    rows.push({ separator: true });

    let testHint = "runs 'id' as the user · starts a stopped distro";
    if (state.lastTest === "ok") {
        testHint = "last run: OK";
    }
    else if (state.lastTest === "failed") {
        testHint = "last run: failed";
    }
    rows.push({ value: "test", key: "test", label: "Test the distro", hint: testHint });
    rows.push({ value: "save", key: "save", label: "Save", hint: `to ${destination}` });
    rows.push({ value: "cancel", key: "cancel", label: "Cancel" });

    return rows;
}

/**
 * Where the cursor goes after a setting is edited: the next row, so pressing Enter down
 * the list fills the form top to bottom. A toggle keeps the cursor, and the last setting
 * hands over to Save.
 */
function nextCursor(state: FormState, destination: string, edited: FieldId): FormValue {
    if (TOGGLE_FIELDS.includes(edited) == true) {
        return edited;
    }

    const values = buildRows(state, destination).flatMap((row) => {
        if ("value" in row) {
            return [row.value];
        }
        return [];
    });

    const next = values[values.indexOf(edited) + 1];
    if (next == null || next === "test") {
        return "save";
    }

    return next;
}

/**
 * Runs the check with the form's current values: the entry goes through the server's own
 * reader, then `id` runs in the distro as the user.
 *
 * @returns True when the distro answered.
 */
async function testDistro(prompter: Prompter, output: Writable, state: FormState): Promise<boolean> {
    output.write("\n");
    const profile = profileFromEnv(output, answersToEntry(state.answers).env);
    if (profile == null) {
        output.write("\n");
        state.lastTest = "failed";
        await prompter.pause();
        return false;
    }

    const answered = await runDistroCheck(profile, output);
    output.write("\n");
    await prompter.pause();

    if (answered == true) {
        state.lastTest = "ok";
        state.testedSnapshot = snapshotOf(state);
        return true;
    }

    state.lastTest = "failed";
    return false;
}

/** Edits one setting. The server name follows a distro or user change until it was set by hand. */
async function editField(prompter: Prompter, state: FormState, distros: WslDistroListing[], id: FieldId): Promise<void> {
    const { answers } = state;

    if (id === "distro") {
        let current: string | undefined;
        if (answers.distro !== "") {
            current = answers.distro;
        }
        answers.distro = await askDistro(prompter, distros, current);
        if (state.nameTouched == false) {
            answers.name = deriveServerName(answers.distro, answers.username);
        }
        return;
    }

    if (id === "user") {
        answers.username = await askOptional(prompter, "Linux user to run as (empty = the distro's default user)", answers.username);
        if (state.nameTouched == false && answers.distro !== "") {
            answers.name = deriveServerName(answers.distro, answers.username);
        }
        return;
    }

    if (id === "name") {
        let current: string | undefined;
        if (answers.name !== "") {
            current = answers.name;
        }
        for (;;) {
            const name = await prompter.askRequired("Server name the agent sees", current);
            if (SERVER_NAME_PATTERN.test(name) == true) {
                answers.name = name;
                state.nameTouched = true;
                return;
            }
            prompter.write("  Use letters, digits, '-' and '_' only (max 48) — the name becomes part of every tool name.\n");
        }
    }

    if (id === "description") {
        answers.description = await askOptional(prompter, "Description shown to the agent (what the distro is for)", answers.description);
        return;
    }

    if (id === "readonly") {
        answers.readonly = answers.readonly == false;
        return;
    }

    if (id === "windows") {
        answers.allowWindows = answers.allowWindows == false;
        return;
    }

    let current: string | undefined;
    if (answers.allowedPaths.length > 0) {
        current = answers.allowedPaths.join(",");
    }
    const typed = await askOptional(prompter, "Limit file tools to path prefixes (comma-separated, empty = anywhere)", current);
    answers.allowedPaths = [];
    if (typed != null) {
        answers.allowedPaths = typed.split(",").map((item) => item.trim()).filter((item) => item !== "");
    }
}

/**
 * The settings form for one distro entry: every setting listed with its value, picked and
 * edited one at a time, in any order, as often as needed. Test and Save sit below the
 * settings. A new entry starts on the default distro, so Save alone is a complete entry.
 *
 * Flow per pick:
 *  1) A setting — edit it, then move the cursor to the next one
 *  2) Test — run the check with the current values
 *  3) Save — require what is missing, settle a name clash, offer a test if the values
 *     changed since the last one, and hand the answers back
 *  4) Cancel / Esc — leave; a form with changes asks first
 *
 * Esc inside whatever a pick opened goes back to the form with that setting unchanged.
 *
 * On a TTY the form redraws in place: answered prompts leave no trail, since the form
 * itself shows every value.
 *
 * @returns The answers to write, or null when cancelled.
 */
export async function runHostForm(prompter: Prompter, output: Writable, options: HostFormOptions): Promise<HostSetupAnswers | null> {
    const { existing, takenNames, destination, distros } = options;

    let state: FormState;
    if (existing != null) {
        state = { answers: { ...existing }, nameTouched: true, lastTest: "never", testedSnapshot: null };
    }
    else {
        const defaultDistro = distros.find((listing) => listing.isDefault == true)?.name ?? "";

        let name = "";
        if (defaultDistro !== "") {
            name = deriveServerName(defaultDistro, undefined);
        }

        state = {
            answers: {
                name: name,
                distro: defaultDistro,
                readonly: false,
                allowWindows: false,
                allowedPaths: [],
                extraEnv: {},
            },
            nameTouched: false,
            lastTest: "never",
            testedSnapshot: null,
        };
    }

    const initialSnapshot = snapshotOf(state);
    const originalName = existing?.name;

    let title = "New distro entry";
    if (existing != null) {
        title = `Editing ${existing.name}`;
    }

    output.write(prompter.paint.dim(`\n  Pick a setting to change it. In a text field, Enter keeps the value shown and ${CLEAR_ANSWER} clears it.\n\n`));

    const previousTransient = prompter.transient;
    prompter.transient = true;

    try {
        let cursor: FormValue = "distro";

        for (;;) {
            const picked = await prompter.select(title, buildRows(state, destination), { defaultValue: cursor, cancelValue: "cancel" });

            // Esc inside anything the pick opened — a field editor, a confirmation, the
            // typed-name question — comes back here as PromptBackError, and the cursor stays on
            // the row that was picked. Nothing needs restoring: every editor assigns only once
            // its prompt is answered, and no WSL setting opens a follow-up question after it
            // has been set (mcp-ssh's route → jump host does, which is why its form snapshots).
            try {
                // (4) Cancel
                if (picked === "cancel") {
                    if (snapshotOf(state) !== initialSnapshot) {
                        const discard = await prompter.askYesNo("Discard the changes?", false);
                        if (discard == false) {
                            continue;
                        }
                    }
                    return null;
                }

                const missing = missingFields(state);

                // (2) Test
                if (picked === "test") {
                    if (missing.length > 0) {
                        output.write(`  Fill in ${missing.map((field) => FIELD_NAMES[field]).join(", ")} first.\n`);
                        cursor = missing[0];
                        continue;
                    }

                    const answered = await testDistro(prompter, output, state);
                    cursor = "test";
                    if (answered == true) {
                        cursor = "save";
                    }
                    continue;
                }

                // (3) Save
                if (picked === "save") {
                    if (missing.length > 0) {
                        output.write(`  Fill in ${missing.map((field) => FIELD_NAMES[field]).join(", ")} first.\n`);
                        cursor = missing[0];
                        continue;
                    }

                    const name = state.answers.name;
                    if (name !== originalName && takenNames.includes(name) == true) {
                        const replace = await prompter.askYesNo(`"${name}" already exists in this file. Replace it?`, false);
                        if (replace == false) {
                            cursor = "name";
                            continue;
                        }
                    }

                    if (snapshotOf(state) !== state.testedSnapshot) {
                        const testFirst = await prompter.askYesNo("Test the distro before saving? (starts it if it is stopped)", true);
                        if (testFirst == true) {
                            const answered = await testDistro(prompter, output, state);
                            if (answered == false) {
                                const next = await prompter.select(
                                    "The check failed. What now?",
                                    [
                                        { value: "back", key: "back", label: "Back to the settings" },
                                        { value: "save", key: "save", label: "Save anyway", hint: "the distro may be installed later" },
                                        { value: "discard", key: "discard", label: "Discard", hint: "nothing is written" },
                                    ],
                                    { defaultValue: "back", cancelValue: "back" },
                                );

                                if (next === "discard") {
                                    return null;
                                }

                                if (next === "back") {
                                    cursor = "test";
                                    continue;
                                }
                            }
                        }
                    }

                    return { ...state.answers };
                }

                // (1) A setting
                await editField(prompter, state, distros, picked);
                cursor = nextCursor(state, destination, picked);
            }
            catch (ex) {
                if (ex instanceof PromptBackError == false) {
                    throw ex;
                }

                cursor = picked;
            }
        }
    }
    finally {
        prompter.transient = previousTransient;
    }
}
