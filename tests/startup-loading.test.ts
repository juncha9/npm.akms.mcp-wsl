import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("WSL runtime loading", () => {
    it("keeps ssh2 unloaded during startup, guard checks and command execution", () => {
        const entry = new URL("../src/index.ts", import.meta.url).href;
        const script = `
            import assert from "node:assert/strict";
            import childProcess from "node:child_process";
            import { createRequire, syncBuiltinESMExports } from "node:module";
            import { sep } from "node:path";
            const require = createRequire(process.cwd() + "/package.json");
            const sshLoaded = () => Object.keys(require.cache).some(file => file.includes(sep + "ssh2" + sep));
            const originalSpawn = childProcess.spawn;
            let spawned = 0;
            // Exercise the real pipe/output lifecycle with a Node fixture. Never start a distro.
            childProcess.spawn = (command, args, options) => {
                assert.equal(command, "wsl.exe");
                assert.deepEqual(args.slice(0, 5), ["-d", "memory-probe", "--exec", "bash", "-lc"]);
                assert.equal(args.length, 6);
                assert.match(args[5], /printf 'ok'/);
                spawned += 1;
                return originalSpawn(process.execPath, ["-e", "process.stdout.write('ok' + String.fromCharCode(10) + '__AKMS_WSL_CWD__/tmp')"], options);
            };
            syncBuiltinESMExports();
            const api = await import(${JSON.stringify(entry)});
            const instance = api.createWslMcpServer();
            try {
                assert(instance.profile);
                assert.equal(sshLoaded(), false);
                const host = new api.WslHost(instance.profile);
                for (const command of ["rm -rf /", "powershell.exe -Command Get-Process", "wsl.exe --shutdown"]) {
                    await assert.rejects(host.exec({ command, timeoutMs: 5000, maxOutputCharacters: 1000 }), api.GuardRejectionError);
                }
                assert.equal(api.inspectWslPath("/mnt/c/Users/test/.ssh/id_rsa", instance.profile, "read").allowed, false);
                assert.equal(spawned, 0);
                const result = await host.exec({ command: "printf 'ok'", timeoutMs: 5000, maxOutputCharacters: 1000, trackCwd: true });
                assert.equal(result.exitCode, 0, result.stderr);
                assert.equal(result.stdout, "ok");
                assert.equal(result.cwd, "/tmp");
                assert.equal(spawned, 1);
                assert.equal(sshLoaded(), false);
                console.log("passed");
            } finally {
                childProcess.spawn = originalSpawn;
                syncBuiltinESMExports();
                instance.shutdown();
                await instance.server.close();
            }
        `;
        const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(WSL_|SSH_|NODE_OPTIONS$)/i.test(key)));
        const result = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
            cwd: fileURLToPath(new URL("..", import.meta.url)),
            env: { ...env, WSL_DISTRO: "memory-probe", WSL_MCP_LOG_LEVEL: "silent", SSH_MCP_LOG_LEVEL: "silent" },
            encoding: "utf8", timeout: 20000, windowsHide: true,
        });
        expect(result.trim()).toBe("passed");
    }, 25000);
});
