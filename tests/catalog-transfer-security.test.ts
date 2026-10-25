import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFileTools } from "../src/modules/tools/file-tools";
import type { ToolContext } from "../src/modules/tools/tool-context";
import { inspectWslPath } from "../src/modules/guard";
import { createProfile } from "./_helpers";

const transfer = vi.hoisted(() => vi.fn(async () => 0));
vi.mock("../src/modules/wsl", async (original) => ({ ...await original<typeof import("../src/modules/wsl")>(), uploadFile: transfer, downloadFile: transfer }));
afterEach(() => { vi.unstubAllEnvs(); transfer.mockClear(); });

describe("catalog transfer security evidence with the installed SSH guard", () => {
    it.each(["wsl_upload", "wsl_download"])("documents that the locked SSH 0.1.9 guard does not block local catalog paths in %s", async (name) => {
        vi.stubEnv("WSL_MCP_LOG_LEVEL", "silent");
        const handlers = new Map<string, (args: unknown) => Promise<{ isError?: boolean }>>();
        registerFileTools({ registerTool: (name: string, _options: unknown, handler: (args: unknown) => Promise<{ isError?: boolean }>) => handlers.set(name, handler) } as unknown as McpServer,
            { host: { profile: createProfile() }, sessions: {} } as ToolContext);
        for(const home of [path.resolve("fixture", ".akms", "mcp"), path.resolve("fixture", "custom-catalog")]) {
            vi.stubEnv("AKMS_MCP_HOME", home);
            const result = await handlers.get(name)!({ localPath: path.join(home, "registry.json"), remotePath: "/tmp/fixture" });
            expect(result.isError).not.toBe(true);
        }
        expect(transfer).toHaveBeenCalledTimes(2);
    });

    it.each(["read", "write"] as const)("blocks default catalog paths through Windows mounts for %s, but not native Linux paths", (access) => {
        const profile = createProfile({ allowWindows: true });
        expect(inspectWslPath("/mnt/c/Users/fixture/.akms/mcp/registry.json", profile, access).allowed).toBe(false);
        expect(inspectWslPath("/mnt/c/Users/fixture/.akms/mcp/backup.json", profile, access).allowed).toBe(false);
        expect(inspectWslPath("/home/fixture/.akms/mcp/registry.json", profile, access).allowed).toBe(true);
    });

    it.runIf(process.platform === "win32")("protects only the configured custom registry through a Windows mount", () => {
        const home = path.resolve("fixture", "custom-catalog");
        vi.stubEnv("AKMS_MCP_HOME", home);
        const mount = `/mnt/${home[0].toLowerCase()}/${home.slice(3).replace(/\\/g, "/")}`;
        const profile = createProfile({ allowWindows: true });
        for(const access of ["read", "write"] as const) {
            expect(inspectWslPath(`${mount}/registry.json`, profile, access).allowed).toBe(false);
            expect(inspectWslPath(`${mount}/registry.previous.json`, profile, access).allowed).toBe(false);
            expect(inspectWslPath(`${mount}/backup.json`, profile, access).allowed).toBe(true);
        }
    });
});
