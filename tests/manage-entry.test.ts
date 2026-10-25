import { describe, expect, it } from "vitest";

import type { HostSetupAnswers } from "@/_types";
import { loadHostProfile } from "@/modules/config";
import { answersToEntry, entryToAnswers, isOurEntry } from "@/modules/manage/entry";

process.env.WSL_MCP_LOG_LEVEL = "silent";

function createAnswers(overrides?: Partial<HostSetupAnswers>): HostSetupAnswers {
    return {
        name: "wsl_ubuntu_root",
        distro: "Ubuntu",
        readonly: false,
        allowWindows: false,
        allowedPaths: [],
        extraEnv: {},
        ...overrides,
    };
}

describe("answersToEntry — what gets written", () => {
    it("writes only the distro when everything else is a default", () => {
        const entry = answersToEntry(createAnswers());

        expect(entry.env).toEqual({ WSL_DISTRO: "Ubuntu" });
    });

    it("creates a direct installed launch without npx", () => {
        const entry = answersToEntry(createAnswers());
        expect(entry.command).not.toBe("npx");
        expect(entry.command).not.toBe("cmd");
        expect(entry.args).not.toContain("npx");
        expect(isOurEntry(entry)).toBe(true);
        if(entry.args.length) {
            expect(entry.command).toBe(process.execPath);
            expect(entry.args[0].replace(/\\/g, "/")).toMatch(/node_modules\/@akms\/mcp-wsl\/lib\/cli\.js$/);
        } else expect(entry.command).toBe("akms-mcp-wsl");
    });

    it("writes every answered setting under its variable", () => {
        const entry = answersToEntry(createAnswers({
            username: "deploy",
            description: "nginx and the test stack",
            readonly: true,
            allowWindows: true,
            allowedPaths: ["/var/log", "/opt/app"],
        }));

        expect(entry.env).toEqual({
            WSL_DISTRO: "Ubuntu",
            WSL_USER: "deploy",
            WSL_DESCRIPTION: "nginx and the test stack",
            WSL_READONLY: "true",
            WSL_ALLOW_WINDOWS: "true",
            WSL_ALLOWED_PATHS: "/var/log,/opt/app",
        });
    });

    it("carries hand-set variables through, but never lets them override an answer", () => {
        const entry = answersToEntry(createAnswers({
            extraEnv: { WSL_EXEC_TIMEOUT_MS: "120000", WSL_NAME: "ubuntu-root", WSL_DISTRO: "stale", WSL_READONLY: "true" },
        }));

        expect(entry.env.WSL_EXEC_TIMEOUT_MS).toBe("120000");
        expect(entry.env.WSL_NAME).toBe("ubuntu-root");
        expect(entry.env.WSL_DISTRO).toBe("Ubuntu");
        expect(entry.env.WSL_READONLY).toBeUndefined();
    });
});

describe("answersToEntry ↔ loadHostProfile — the contract with the server", () => {
    it("produces an env block the server reads back as the same distro", () => {
        const entry = answersToEntry(createAnswers({
            username: "deploy",
            readonly: true,
            allowWindows: true,
            allowedPaths: ["/var/log"],
            extraEnv: { WSL_CWD: "/opt/app", WSL_ALLOW_SUDO: "false" },
        }));

        const profile = loadHostProfile(entry.env);

        expect(profile?.distro).toBe("Ubuntu");
        expect(profile?.username).toBe("deploy");
        expect(profile?.defaultCwd).toBe("/opt/app");
        expect(profile?.allowWindows).toBe(true);
        expect(profile?.policy.readonly).toBe(true);
        expect(profile?.policy.allowSudo).toBe(false);
        expect(profile?.policy.allowedPaths).toEqual(["/var/log"]);
    });

    it("surfaces a value the server would refuse, before it is written", () => {
        const entry = answersToEntry(createAnswers({ extraEnv: { WSL_ALLOW_SUDO: "nope" } }));

        expect(() => loadHostProfile(entry.env)).toThrow(/WSL_ALLOW_SUDO/);
    });

    it("does not touch the process environment while reading an entry", () => {
        loadHostProfile({ WSL_DISTRO: "Ubuntu", WSL_USER: "deploy" });

        expect(process.env.WSL_DISTRO).toBeUndefined();
        expect(process.env.WSL_USER).toBeUndefined();
    });
});

describe("entryToAnswers — pre-filling an edit", () => {
    it("round-trips a full entry without losing a variable", () => {
        const original = answersToEntry(createAnswers({
            username: "deploy",
            description: "test stack",
            readonly: true,
            allowWindows: true,
            allowedPaths: ["/var/log", "/opt/app"],
            extraEnv: { WSL_CWD: "/opt/app", WSL_DENY_PATTERNS: "\\bcurl\\b" },
        }));

        const answers = entryToAnswers("wsl_ubuntu_root", original);
        const rewritten = answersToEntry(answers);

        expect(rewritten.env).toEqual(original.env);
        expect(answers.username).toBe("deploy");
        expect(answers.allowWindows).toBe(true);
    });

    it("reads a hand-written boolean spelling, and an absent user as the distro default", () => {
        const answers = entryToAnswers("wsl_ubuntu", {
            command: "npx",
            args: ["-y", "@akms/mcp-wsl"],
            env: { WSL_DISTRO: "Ubuntu", WSL_READONLY: "yes", WSL_ALLOW_WINDOWS: "off" },
        });

        expect(answers.readonly).toBe(true);
        expect(answers.allowWindows).toBe(false);
        expect(answers.username).toBeUndefined();
    });
});

describe("isOurEntry", () => {
    it("recognizes every way the package is launched", () => {
        expect(isOurEntry({ command: "npx", args: ["-y", "@akms/mcp-wsl"], env: {} })).toBe(true);
        expect(isOurEntry({ command: "cmd", args: ["/c", "npx", "-y", "@akms/mcp-wsl"], env: {} })).toBe(true);
        expect(isOurEntry({ command: "akms-mcp-wsl", args: [], env: {} })).toBe(true);
        expect(isOurEntry({ command: "C:\\nodejs\\akms-mcp-wsl.cmd", args: [], env: {} })).toBe(true);
    });

    it("leaves other servers alone, the SSH sibling included", () => {
        expect(isOurEntry({ command: "postgres-mcp", args: ["--access-mode=unrestricted"], env: {} })).toBe(false);
        expect(isOurEntry({ command: "cmd", args: ["/c", "npx", "-y", "@akms/mcp-ssh"], env: {} })).toBe(false);
        expect(isOurEntry({ command: "npx", args: ["-y", "@other/mcp-wsl"], env: {} })).toBe(false);
    });
});
