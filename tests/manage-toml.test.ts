import { describe, expect, it } from "vitest";

import type { McpServerEntry } from "@/_types";
import { parseMcpServersToml, renderMcpServerTable, writeMcpServerToml } from "@/modules/manage/targets/toml-subset";

/** A Codex config as a person keeps it: settings, comments, another server, a hand-tuned key. */
const CODEX_CONFIG = [
    "model = \"gpt-5-codex\"",
    "approval_policy = \"on-request\"  # ask before running",
    "",
    "[mcp_servers.docs]",
    "command = \"docs-mcp\"",
    "args = [",
    "    \"--port\",",
    "    \"9000\",",
    "]",
    "env = { DOCS_TOKEN = \"abc\" }",
    "",
    "[mcp_servers.wsl-ubuntu]",
    "command = \"npx\"",
    "args = [\"-y\", \"@akms/mcp-wsl\"]",
    "startup_timeout_sec = 30",
    "",
    "[mcp_servers.wsl-ubuntu.env]",
    "WSL_DISTRO = \"Ubuntu\"",
    "WSL_USER = \"deploy\"",
    "",
    "[mcp_servers.wsl-ubuntu.tools.wsl_exec]",
    "approval_mode = \"always\"",
    "",
    "[profiles.fast]",
    "model = \"gpt-5-mini\"",
    "",
].join("\n");

const NEW_ENTRY: McpServerEntry = {
    command: "npx",
    args: ["-y", "@akms/mcp-wsl"],
    env: {
        WSL_DISTRO: "Debian",
        WSL_USER: "ops",
        WSL_DENY_PATTERNS: "\\bcurl\\b.*\\|\\s*sh,\\\\wsl\\$",
        WSL_DESCRIPTION: "the \"new\" distro",
    },
};

describe("parseMcpServersToml", () => {
    it("reads every server, with env from a sub-table or an inline table", () => {
        const entries = parseMcpServersToml(CODEX_CONFIG);

        expect(entries.docs).toEqual({ command: "docs-mcp", args: ["--port", "9000"], env: { DOCS_TOKEN: "abc" } });
        expect(entries["wsl-ubuntu"]).toEqual({
            command: "npx",
            args: ["-y", "@akms/mcp-wsl"],
            env: { WSL_DISTRO: "Ubuntu", WSL_USER: "deploy" },
        });
        expect(Object.keys(entries)).toEqual(["docs", "wsl-ubuntu"]);
    });

    it("returns nothing for an empty file", () => {
        expect(parseMcpServersToml("")).toEqual({});
    });
});

describe("writeMcpServerToml", () => {
    it("round-trips backslashes and quotes through rendering and parsing", () => {
        const text = renderMcpServerTable("wsl-debian", NEW_ENTRY);

        expect(parseMcpServersToml(text)["wsl-debian"]).toEqual(NEW_ENTRY);
    });

    it("appends a new server after a blank line, leaving the file before it byte for byte", () => {
        const updated = writeMcpServerToml(CODEX_CONFIG, "wsl-debian", NEW_ENTRY);

        expect(updated.startsWith(CODEX_CONFIG.replace(/\n+$/, ""))).toBe(true);
        expect(updated).toContain("gpt-5-mini\"\n\n[mcp_servers.wsl-debian]\n");
        expect(parseMcpServersToml(updated)["wsl-debian"]).toEqual(NEW_ENTRY);
    });

    it("creates a file from nothing", () => {
        const updated = writeMcpServerToml("", "wsl-debian", NEW_ENTRY);

        expect(updated).toBe(renderMcpServerTable("wsl-debian", NEW_ENTRY));
    });

    it("replaces command, args and env but keeps the keys and sub-tables added by hand", () => {
        const updated = writeMcpServerToml(CODEX_CONFIG, "wsl-ubuntu", NEW_ENTRY);

        expect(parseMcpServersToml(updated)["wsl-ubuntu"]).toEqual(NEW_ENTRY);
        expect(updated).toContain("startup_timeout_sec = 30");
        expect(updated).toContain("[mcp_servers.wsl-ubuntu.tools.wsl_exec]\napproval_mode = \"always\"");
        expect(updated).not.toContain("WSL_DISTRO = \"Ubuntu\"");
    });

    it("leaves every other server and setting untouched on replace", () => {
        const updated = writeMcpServerToml(CODEX_CONFIG, "wsl-ubuntu", NEW_ENTRY);
        const entries = parseMcpServersToml(updated);

        expect(entries.docs).toEqual(parseMcpServersToml(CODEX_CONFIG).docs);
        expect(updated.startsWith(CODEX_CONFIG.slice(0, CODEX_CONFIG.indexOf("[mcp_servers.wsl-ubuntu]")))).toBe(true);
        expect(updated.endsWith("[profiles.fast]\nmodel = \"gpt-5-mini\"\n")).toBe(true);
    });

    it("is stable: writing the same entry twice gives the same text", () => {
        const once = writeMcpServerToml(CODEX_CONFIG, "wsl-ubuntu", NEW_ENTRY);
        const twice = writeMcpServerToml(once, "wsl-ubuntu", NEW_ENTRY);

        expect(twice).toBe(once);
    });

    it("removes the server with all of its sub-tables and nothing else", () => {
        const updated = writeMcpServerToml(CODEX_CONFIG, "wsl-ubuntu", null);

        expect(parseMcpServersToml(updated)["wsl-ubuntu"]).toBeUndefined();
        expect(updated).not.toContain("wsl-ubuntu");
        expect(updated).toContain("[mcp_servers.docs]");
        expect(updated).toContain("[profiles.fast]");
        expect(updated).not.toContain("\n\n\n");
    });

    it("keeps CRLF line endings", () => {
        const crlf = CODEX_CONFIG.replace(/\n/g, "\r\n");
        const updated = writeMcpServerToml(crlf, "wsl-ubuntu", NEW_ENTRY);

        expect(updated.replace(/\r\n/g, "")).not.toContain("\n");
        expect(parseMcpServersToml(updated)["wsl-ubuntu"]).toEqual(NEW_ENTRY);
    });

    it("does not mistake a line of a multi-line array for a table header", () => {
        const text = [
            "[mcp_servers.wsl-ubuntu]",
            "command = \"npx\"",
            "args = [",
            "[\"nested\"],",
            "]",
            "",
        ].join("\n");

        const updated = writeMcpServerToml(text, "wsl-ubuntu", NEW_ENTRY);

        expect(parseMcpServersToml(updated)["wsl-ubuntu"]).toEqual(NEW_ENTRY);
        expect(updated).not.toContain("nested");
    });
});
