import { describe, expect, it } from "vitest";
import { BoundedMap } from "./bounded-map.js";

describe("BoundedMap", () => {
  it("evicts the oldest entry once the cap is hit", () => {
    const map = new BoundedMap<string, number>(2);
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    expect(map.has("a")).toBe(false);
    expect(map.get("b")).toBe(2);
    expect(map.get("c")).toBe(3);
    expect(map.size).toBe(2);
  });

  it("re-setting an existing key resets its insertion position to newest", () => {
    const map = new BoundedMap<string, number>(2);
    map.set("a", 1);
    map.set("b", 2);
    map.set("a", 11); // a now newest
    map.set("c", 3); // evicts b
    expect(map.has("b")).toBe(false);
    expect(map.get("a")).toBe(11);
    expect(map.get("c")).toBe(3);
  });

  it("delete and clear behave like a regular Map", () => {
    const map = new BoundedMap<string, number>(3);
    map.set("a", 1);
    expect(map.delete("a")).toBe(true);
    expect(map.delete("a")).toBe(false);
    map.set("b", 2);
    map.clear();
    expect(map.size).toBe(0);
  });
});
