import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDistroCheck } from "@/modules/manage/connection-check";
import { WslHost, probeDistroFacts, queryDistroListing } from "@/modules/wsl";
import { createProfile } from "./_helpers";

vi.mock("@/modules/wsl", () => ({
    WslHost: class { async exec() { throw new Error("unexpected user probe"); } },
    queryDistroListing: vi.fn(),
    probeDistroFacts: vi.fn(),
}));

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("TERM", "xterm");
    vi.mocked(queryDistroListing).mockResolvedValue({ installed: true, state: "Stopped", wslVersion: 2 });
    vi.mocked(probeDistroFacts).mockResolvedValue({ kernel: "test-kernel", systemd: true });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

function terminal() {
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80 });
    let screen = "";
    output.on("data", (chunk: Buffer) => { screen += chunk.toString(); });
    return { output, screen: () => screen };
}

describe("animated distro checks", () => {
    it("waits for the user probe before moving to distribution information", async () => {
        const probe = { stdout: "uid=0(root)", stderr: "", exitCode: 0, durationMs: 1, truncated: false };
        let finishProbe!: (value: typeof probe) => void;
        // Install the same pending probe on every host constructed by the check.
        vi.spyOn(WslHost.prototype, "exec").mockImplementation(() => new Promise((resolve) => { finishProbe = resolve; }));
        const screen = terminal();
        const checked = runDistroCheck(createProfile(), screen.output);
        await Promise.resolve();
        expect(screen.screen()).toContain("Finding WSL distribution");
        expect(screen.screen()).toContain("Starting distribution and checking user");
        expect(screen.screen()).not.toContain("Reading distribution information");

        finishProbe(probe);
        expect(await checked).toBe(true);
        expect(screen.screen()).toContain("Reading distribution information");
        expect(screen.screen()).toContain("OK      uid=0(root)");
        expect(vi.getTimerCount()).toBe(0);
    });

    it("stops at a missing distribution and does not start a host", async () => {
        vi.mocked(queryDistroListing).mockResolvedValue({ installed: false, state: "unknown" });
        const screen = terminal();
        expect(await runDistroCheck(createProfile(), screen.output)).toBe(false);
        expect(screen.screen()).toContain("FAILED");
        expect(screen.screen()).not.toContain("Starting distribution");
        expect(probeDistroFacts).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("stops the animation when wsl.exe cannot start", async () => {
        vi.mocked(queryDistroListing).mockRejectedValue(new Error("spawn failed"));
        const screen = terminal();
        expect(await runDistroCheck(createProfile(), screen.output)).toBe(false);
        expect(screen.screen()).toContain("spawn failed");
        expect(vi.getTimerCount()).toBe(0);
    });
});
