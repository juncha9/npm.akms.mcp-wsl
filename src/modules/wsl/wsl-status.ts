import { spawn } from "node:child_process";

import { WSL_EXECUTABLE } from "@/_defs";
import { $logger } from "@/_libs";
import type { WslDistroListing, WslDistroStatus } from "@/_types";

import type { WslHost } from "./wsl-host";

const LISTING_TIMEOUT_MS = 10_000;

/** Bytes to keep from a probe — a few lines at most. */
const PROBE_CAPTURE_BYTES = 64 * 1024;

/** One row of `wsl -l -v`: optional default marker, name, state, version. */
const LISTING_ROW_PATTERN = /^\s*(\*?)\s*(.+?)\s+(Running|Stopped|Installing)\s+(\d)\s*$/;

/**
 * Every distro `wsl.exe -l -v` lists. Does not start any of them — that is what makes
 * this safe to call from `wsl_list_hosts`, `--check` and the `setup` form.
 *
 * @throws {Error} If `wsl.exe` cannot be started at all.
 */
export async function listDistros(): Promise<WslDistroListing[]> {
    const listing = await new Promise<string>((resolve, reject) => {
        const child = spawn(WSL_EXECUTABLE, ["-l", "-v"], {
            env: { ...process.env, WSL_UTF8: "1" },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });

        const chunks: Buffer[] = [];
        const timer = setTimeout(() => {
            child.kill();
        }, LISTING_TIMEOUT_MS);
        timer.unref();

        child.stdout.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("close", () => {
            clearTimeout(timer);
            resolve(Buffer.concat(chunks).toString("utf8"));
        });
    });

    const distros: WslDistroListing[] = [];
    for (const line of listing.split(/\r?\n/)) {
        const match = LISTING_ROW_PATTERN.exec(line);
        if (match == null) {
            continue;
        }

        distros.push({
            name: match[2],
            state: match[3] as WslDistroListing["state"],
            wslVersion: Number(match[4]),
            isDefault: match[1] === "*",
        });
    }

    return distros;
}

/**
 * What `wsl.exe -l -v` says about the distro. Does not start it.
 *
 * @throws {Error} If `wsl.exe` cannot be started at all.
 */
export async function queryDistroListing(distro: string): Promise<WslDistroStatus> {
    const _logger = $logger.child({ context: "queryDistroListing", distro: distro });

    const distros = await listDistros();
    const listed = distros.find((candidate) => candidate.name.toLowerCase() === distro.toLowerCase());
    if (listed == null) {
        _logger.warn("distro not present in wsl -l -v");
        return { installed: false, state: "unknown" };
    }

    return {
        installed: true,
        state: listed.state,
        wslVersion: listed.wslVersion,
    };
}

/**
 * Facts only visible from inside: networking mode, whether systemd is PID 1, the kernel.
 * Starts the distro when it is stopped, so callers check the listing first and skip this
 * for a stopped distro unless starting it is the intent.
 *
 * Runs as a fixed script through `runProcess`, bypassing the command guard — the script
 * has no variable part and an allow-list profile must still be able to describe itself.
 */
export async function probeDistroFacts(host: WslHost): Promise<Pick<WslDistroStatus, "networkingMode" | "systemd" | "kernel">> {
    const script = [
        "printf 'mode=%s\\n' \"$(wslinfo --networking-mode 2>/dev/null || echo unknown)\"",
        "printf 'init=%s\\n' \"$(ps -p 1 -o comm= 2>/dev/null || echo unknown)\"",
        "printf 'kernel=%s\\n' \"$(uname -r 2>/dev/null || echo unknown)\"",
    ].join("\n");

    const output = await host.runProcess({
        script: script,
        timeoutMs: LISTING_TIMEOUT_MS,
        maxCapturedBytes: PROBE_CAPTURE_BYTES,
    });

    const facts: Pick<WslDistroStatus, "networkingMode" | "systemd" | "kernel"> = {};
    for (const line of output.stdout.toString("utf8").split("\n")) {
        const [key, ...rest] = line.split("=");
        const value = rest.join("=").trim();
        if (key === "mode") {
            facts.networkingMode = value;
        }
        else if (key === "init") {
            facts.systemd = value === "systemd";
        }
        else if (key === "kernel") {
            facts.kernel = value;
        }
    }

    return facts;
}
