import { describe, expect, it } from "vitest";
import { type LaunchCandidate, pickBestLaunchCandidate, rankLaunchCandidates } from "./app-launch.js";

describe("pickBestLaunchCandidate", () => {
  const candidates: LaunchCandidate[] = [
    { kind: "start-app", name: "Stremio", appId: "C:\\Apps\\Stremio\\stremio.exe" },
    { kind: "command", name: "chrome.exe", path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
  ];

  it("prefers exact matches", () => {
    expect(pickBestLaunchCandidate("Stremio", candidates)).toMatchObject({
      candidate: { kind: "start-app", name: "Stremio" },
      exactMatch: true,
    });
  });

  it("accepts close fuzzy matches", () => {
    expect(pickBestLaunchCandidate("stermio", candidates)).toMatchObject({
      candidate: { kind: "start-app", name: "Stremio" },
    });
  });

  it("rejects low-confidence guesses", () => {
    expect(pickBestLaunchCandidate("calendar", candidates)).toBeNull();
  });
});

describe("rankLaunchCandidates", () => {
  it("sorts stronger matches first", () => {
    const ranked = rankLaunchCandidates("chrome", [
      { kind: "command", name: "notepad.exe", path: "C:\\Windows\\System32\\notepad.exe" },
      { kind: "command", name: "chrome.exe", path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
    ]);

    expect(ranked[0]?.candidate).toMatchObject({ name: "chrome.exe" });
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });
});
