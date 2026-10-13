import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ConfigTarget, McpServerEntry, WslDistroListing } from "@/_types";
import { runConfigCommand } from "@/modules/manage";
import { createJsonFileTarget } from "@/modules/manage/targets/json-file";
import { listDistros } from "@/modules/wsl";

import { LIVE_DISTRO, LIVE_ENABLED, LIVE_USER } from "./_helpers";

process.env.WSL_MCP_LOG_LEVEL = "silent";
process.env.SSH_MCP_LOG_LEVEL = "silent";

/** An unrelated server, the SSH sibling, and a setting — none of which the manager may disturb. */
const SEED_DOCUMENT = {
    theme: "dark",
    mcpServers: {
        postgres: { command: "postgres-mcp", args: ["--access-mode=restricted"], env: { DATABASE_URI: "postgres://x" } },
        "ssh-prod": { command: "cmd", args: ["/c", "npx", "-y", "@akms/mcp-ssh"], env: { SSH_HOST: "10.0.0.5", SSH_USER: "deploy" } },
    },
};

/** What the form is shown instead of this machine's `wsl -l -v`. */
const DISTROS: WslDistroListing[] = [
    { name: "Ubuntu", state: "Running", wslVersion: 2, isDefault: true },
    { name: "Debian", state: "Stopped", wslVersion: 2, isDefault: false },
];

/** Not installed anywhere — `wsl -l -v` (the real one) reports it missing. */
const MISSING_DISTRO = "akms-no-such-distro";

/** Off a TTY, a line of just this stands for the Esc key. */
const ESC = "\u001b";

let workDirectory = "";
let configPath = "";
let target: ConfigTarget;

beforeEach(() => {
    workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-wsl-config-"));
    configPath = path.join(workDirectory, "mcp.json");
    fs.writeFileSync(configPath, `${JSON.stringify(SEED_DOCUMENT, null, 2)}\n`);
    target = createJsonFileTarget({ id: "cursor", label: "Test client", filePath: configPath });
});

afterEach(() => {
    fs.rmSync(workDirectory, { recursive: true, force: true });
});

/**
 * Drives the manager with the given answers, one per line, and returns its screen. Off a
 * TTY every list is numbered; an answer picks by number, key (a form row's id) or label.
 */
async function runScript(
    lines: string[],
    distroLister: () => Promise<WslDistroListing[]> = async () => DISTROS,
): Promise<{ exitCode: number; screen: string }> {
    const input = new PassThrough();
    const output = new PassThrough();

    let screen = "";
    output.on("data", (chunk: Buffer) => {
        screen += chunk.toString();
    });

    input.end(lines.map((line) => `${line}\n`).join(""));

    const exitCode = await runConfigCommand({ input: input, output: output, targets: [target], listDistros: distroLister });
    return { exitCode: exitCode, screen: screen };
}

function readDocument(): { theme: string; mcpServers: Record<string, McpServerEntry> } {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function seedHost(name: string, env: Record<string, string>): void {
    const document = readDocument();
    document.mcpServers[name] = { command: "cmd", args: ["/c", "npx", "-y", "@akms/mcp-wsl"], env: env };
    fs.writeFileSync(configPath, JSON.stringify(document, null, 2));
}

describe("config — the settings form", () => {
    it("starts on the default distro, so Save alone writes a complete entry", async () => {
        const { exitCode, screen } = await runScript([
            "a",                       // main menu → add
            "save",
            "n",                       // test before saving? no
            "",                        // write it? yes
            "q",
        ]);

        expect(exitCode).toBe(0);
        expect(screen).toMatch(/Distro {10}Ubuntu/);
        expect(screen).toMatch(/User {12}distro default/);
        expect(screen).toMatch(/Server name {5}wsl_ubuntu/);
        expect(screen).toMatch(/Windows access {2}locked/);

        const document = readDocument();
        expect(document.mcpServers.wsl_ubuntu).toEqual({
            command: "cmd",
            args: ["/c", "npx", "-y", "@akms/mcp-wsl"],
            env: { WSL_DISTRO: "Ubuntu" },
        });
        expect(document.theme).toBe("dark");
        expect(document.mcpServers.postgres).toEqual(SEED_DOCUMENT.mcpServers.postgres);
        expect(document.mcpServers["ssh-prod"]).toEqual(SEED_DOCUMENT.mcpServers["ssh-prod"]);
    });

    it("edits settings in any order and writes every one of them", async () => {
        await runScript([
            "a",
            "paths", "/var/log,/opt/app",        // pick a setting, then its value
            "distro", "Debian",                  // the distro is a list of what wsl -l -v reports
            "readonly",                          // a toggle — no value to type
            "user", "deploy",
            "description", "Test box",
            "save", "n", "",
            "q",
        ]);

        expect(readDocument().mcpServers.wsl_debian_deploy.env).toEqual({
            WSL_DISTRO: "Debian",
            WSL_USER: "deploy",
            WSL_DESCRIPTION: "Test box",
            WSL_READONLY: "true",
            WSL_ALLOWED_PATHS: "/var/log,/opt/app",
        });
    });

    it("moves the cursor to the next setting, so Enter walks down the list", async () => {
        await runScript([
            "a",
            "",                        // cursor on Distro → edit it
            "2",                       // → Debian
            "",                        // cursor moved to User → edit it
            "ops",
            "save", "n", "",
            "q",
        ]);

        expect(readDocument().mcpServers.wsl_debian_ops.env).toEqual({ WSL_DISTRO: "Debian", WSL_USER: "ops" });
    });

    it("lets the server name follow the distro and user until it is set by hand", async () => {
        const { screen } = await runScript([
            "a",
            "user", "root",
            "distro", "debian",        // matched in any case, written as wsl.exe spells it
            "name", "mine",
            "user", "ops",             // no longer followed
            "save", "n", "",
            "q",
        ]);

        expect(screen).toMatch(/Server name {5}wsl_ubuntu_root/);
        expect(screen).toMatch(/Server name {5}wsl_debian_root/);
        expect(readDocument().mcpServers.mine.env).toEqual({ WSL_DISTRO: "Debian", WSL_USER: "ops" });
    });

    it("toggles Windows access on Enter and keeps the cursor there", async () => {
        await runScript([
            "a",
            "windows",                 // open
            "",                        // cursor stayed: locked again
            "",                        // and open
            "save", "n", "",
            "q",
        ]);

        expect(readDocument().mcpServers.wsl_ubuntu.env).toEqual({ WSL_DISTRO: "Ubuntu", WSL_ALLOW_WINDOWS: "true" });
    });

    it("asks before using a distro wsl.exe does not list", async () => {
        const { screen } = await runScript([
            "a",
            "distro", "other",         // Another name…
            "Arch", "n",               // not listed — use anyway? no
            "Arch", "y",               // …and yes the second time
            "save", "n", "",
            "q",
        ]);

        expect(screen).toContain("Arch is not in 'wsl -l -v'");
        expect(readDocument().mcpServers.wsl_arch.env).toEqual({ WSL_DISTRO: "Arch" });
    });

    it("refuses to save without a distro, and still runs when none can be listed", async () => {
        const { screen } = await runScript(
            [
                "a",
                "save",                // nothing listed, nothing filled in
                "distro", "Ubuntu", "y",
                "save", "n", "",
                "q",
            ],
            async () => {
                throw new Error("spawn wsl.exe ENOENT");
            },
        );

        expect(screen).toContain("Could not list the installed distros: spawn wsl.exe ENOENT");
        expect(screen).toMatch(/Distro {10}\(required\)/);
        expect(screen).toContain("Fill in Distro first.");
        expect(readDocument().mcpServers.wsl_ubuntu.env).toEqual({ WSL_DISTRO: "Ubuntu" });
    });

    it("Esc inside a field editor goes back to the form with nothing changed", async () => {
        const { screen } = await runScript([
            "a",
            "user", "root",                           // a real change first
            "distro", ESC,                            // open the distro list, leave it
            "distro", "other", "Arch", "n", ESC,      // Esc at the re-asked name undoes the whole distro edit
            "description", ESC,                       // leave the description editor
            "save", "n", "",
            "q",
        ]);

        expect(screen).not.toContain(`Distro          ${ESC}`);
        expect(readDocument().mcpServers.wsl_ubuntu_root.env).toEqual({ WSL_DISTRO: "Ubuntu", WSL_USER: "root" });
    });

    it("Esc at the write preview reopens the form on the same values", async () => {
        const { screen } = await runScript([
            "a",
            "user", "root",
            "save", "n",               // test before saving? no
            ESC,                       // write it? → back to the form
            "description", "second pass",
            "save", "n",
            "",                        // write it? yes
            "q",
        ]);

        expect(screen).toContain("Editing wsl_ubuntu_root");
        expect(readDocument().mcpServers.wsl_ubuntu_root.env).toEqual({
            WSL_DISTRO: "Ubuntu",
            WSL_USER: "root",
            WSL_DESCRIPTION: "second pass",
        });
    });

    it("asks before discarding changes, and leaves an untouched form at once", async () => {
        const { screen } = await runScript([
            "a", "cancel",             // untouched — leaves without asking
            "a", "user", "root",
            "cancel", "n",             // discard? no → back in the form
            "cancel", "y",             // discard? yes
            "q",
        ]);

        expect(screen.match(/Discard the changes\?/g)?.length).toBe(2);
        expect(screen.match(/nothing was written/g)?.length).toBe(2);
        expect(readDocument().mcpServers).toEqual(SEED_DOCUMENT.mcpServers);
    });

    it("shows a failed test on its row, and writes nothing when the operator discards", async () => {
        const { screen } = await runScript([
            "a",
            "distro", "other", MISSING_DISTRO, "y",
            "test",                    // fails: wsl -l -v does not list it
            "save",
            "",                        // test before saving? yes — the values were never tested OK
            "discard",                 // the check failed, what now? → discard
            "q",
        ]);

        expect(screen).toContain("FAILED");
        expect(screen).toContain("last run: failed");
        expect(screen).toContain("nothing was written");
        expect(readDocument().mcpServers).toEqual(SEED_DOCUMENT.mcpServers);
    });

    it("re-asks a server name that could not be part of a tool name", async () => {
        const { screen } = await runScript(["a", "name", "my.distro", "ok-name", "save", "n", "", "q"]);

        expect(screen).toContain("Use letters, digits");
        expect(readDocument().mcpServers["ok-name"]).toBeDefined();
    });

    it("asks before replacing an entry of the same name", async () => {
        seedHost("wsl_ubuntu", { WSL_DISTRO: "Ubuntu", WSL_USER: "root" });

        await runScript([
            "a",
            "save",
            "n",                       // replace wsl_ubuntu? no → the cursor goes to the name
            "", "wsl_ubuntu_2",
            "save", "n", "",
            "q",
        ]);

        const servers = readDocument().mcpServers;
        expect(servers.wsl_ubuntu.env).toEqual({ WSL_DISTRO: "Ubuntu", WSL_USER: "root" });
        expect(servers.wsl_ubuntu_2.env).toEqual({ WSL_DISTRO: "Ubuntu" });
    });
});

describe("config — managing existing entries", () => {
    it("lists only this package's servers as the menu, and counts the rest", async () => {
        seedHost("wsl_ubuntu_root", { WSL_DISTRO: "Ubuntu", WSL_USER: "root", WSL_READONLY: "true" });
        seedHost("wsl_ubuntu", { WSL_DISTRO: "Ubuntu" });

        const { screen } = await runScript(["q"]);

        expect(screen).toContain("2 WSL entries — pick one to manage it");
        expect(screen).toContain("1) wsl_ubuntu_root  root@Ubuntu  readonly");
        expect(screen).toMatch(/2\) wsl_ubuntu {7}Ubuntu {7}default user/);
        expect(screen).toContain("2 other MCP server(s)");
        expect(screen).not.toMatch(/\d\) (postgres|ssh-prod)/);
    });

    it("renames on edit, keeping the variables the form does not show", async () => {
        seedHost("wsl_old", { WSL_DISTRO: "Ubuntu", WSL_USER: "deploy", WSL_CWD: "/opt/app", WSL_NAME: "ubuntu" });

        await runScript([
            "wsl_old",                 // pick the entry by name
            "e",                       // → edit: its settings open
            "name", "wsl_new",         // change just the name
            "save", "n", "",
            "q",
        ]);

        const servers = readDocument().mcpServers;
        expect(servers.wsl_old).toBeUndefined();
        expect(servers.wsl_new.env).toEqual({
            WSL_DISTRO: "Ubuntu",
            WSL_USER: "deploy",
            WSL_CWD: "/opt/app",
            WSL_NAME: "ubuntu",
        });
    });

    it("clears the user with -, falling back to the distro default", async () => {
        seedHost("wsl_ubuntu_deploy", { WSL_DISTRO: "Ubuntu", WSL_USER: "deploy" });

        await runScript(["1", "e", "user", "-", "save", "n", "", "q"]);

        expect(readDocument().mcpServers.wsl_ubuntu_deploy.env).toEqual({ WSL_DISTRO: "Ubuntu" });
    });

    it("checks a stored entry through the server's own reader before running anything", async () => {
        seedHost("wsl_broken", { WSL_DISTRO: "Ubuntu", WSL_EXEC_TIMEOUT_MS: "soon" });

        const { screen } = await runScript(["1", "c", "q"]);

        expect(screen).toContain("The server would refuse to start with this entry: WSL_EXEC_TIMEOUT_MS must be a positive integer");
    });

    it("reports a stored distro that is no longer installed, and changes nothing", async () => {
        seedHost("wsl_gone", { WSL_DISTRO: MISSING_DISTRO });
        const before = fs.readFileSync(configPath, "utf8");

        const { screen } = await runScript(["1", "c", "q"]);

        expect(screen).toContain(`Checking ${MISSING_DISTRO}`);
        expect(screen).toContain("FAILED");
        expect(fs.readFileSync(configPath, "utf8")).toBe(before);
    });

    it("prints the entry in every form, ready to paste", async () => {
        seedHost("wsl_ubuntu_root", { WSL_DISTRO: "Ubuntu", WSL_USER: "root" });

        const { screen } = await runScript(["1", "p", "q"]);

        expect(screen).toContain("\"wsl_ubuntu_root\": {");
        expect(screen).toContain("[mcp_servers.wsl_ubuntu_root.env]");
        expect(screen).toContain("claude mcp add-json wsl_ubuntu_root '{\"type\":\"stdio\"");
    });

    it("removes an entry only after confirmation", async () => {
        seedHost("wsl_a", { WSL_DISTRO: "Ubuntu", WSL_USER: "a" });
        seedHost("wsl_b", { WSL_DISTRO: "Ubuntu", WSL_USER: "b" });

        await runScript([
            "2", "r", "n",             // wsl_b → remove → no
            "wsl_a", "r", "y",         // wsl_a → remove → yes
            "q",
        ]);

        const servers = readDocument().mcpServers;
        expect(servers.wsl_a).toBeUndefined();
        expect(servers.wsl_b).toBeDefined();
        expect(servers.postgres).toBeDefined();
        expect(servers["ssh-prod"]).toBeDefined();
    });

    it("refuses to touch a file it cannot parse", async () => {
        fs.writeFileSync(configPath, "{ \"mcpServers\": ");

        const { exitCode, screen } = await runScript(["a", "q"]);

        expect(exitCode).toBe(0);
        expect(screen).toContain("Cannot read it");
        expect(fs.readFileSync(configPath, "utf8")).toBe("{ \"mcpServers\": ");
    });

    it("Esc at a confirmation goes back to the list and removes nothing", async () => {
        seedHost("wsl_a", { WSL_DISTRO: "Ubuntu", WSL_USER: "a" });

        const { screen } = await runScript(["1", "r", ESC, "q"]);

        expect(screen).not.toContain("Failed:");
        expect(readDocument().mcpServers.wsl_a).toBeDefined();
    });

    it("treats input running out, and Esc at the main menu, as leaving", async () => {
        const ranOut = await runScript([]);
        const escaped = await runScript([ESC]);

        expect(ranOut.exitCode).toBe(0);
        expect(escaped.exitCode).toBe(0);
    });

    it("rejects an unknown --target before showing anything", async () => {
        const output = new PassThrough();
        let screen = "";
        output.on("data", (chunk: Buffer) => {
            screen += chunk.toString();
        });

        const exitCode = await runConfigCommand({ input: new PassThrough(), output: output, targets: [target], targetId: "vscode" });

        expect(exitCode).toBe(1);
        expect(screen).toContain("Unknown client \"vscode\". One of: cursor");
    });
});

describe.skipIf(LIVE_ENABLED == false)("config — against a real distro", () => {
    it("lists it from wsl.exe, tests it as the user before saving, and writes the entry", async () => {
        const { screen } = await runScript(
            [
                "a",
                "distro", LIVE_DISTRO,
                "user", LIVE_USER,
                "name", "live",
                "save",
                "",                    // test before saving? yes
                "",                    // write it? yes
                "q",
            ],
            listDistros,
        );

        expect(screen).toContain("OK      uid=");
        const entry = readDocument().mcpServers.live;
        expect(entry.env.WSL_DISTRO.toLowerCase()).toBe(LIVE_DISTRO.toLowerCase());
        expect(entry.env.WSL_USER).toBe(LIVE_USER);
    }, 60_000);
});
