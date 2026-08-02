import { describe, expect, it } from "vitest";
import { createProxyFetch } from "../src/net/proxy";

describe("createProxyFetch", () => {
  it("returns native fetch when no proxy URL configured", () => {
    expect(createProxyFetch()).toBe(fetch);
    expect(createProxyFetch("")).toBe(fetch);
  });

  it("returns a fetch-compatible wrapper for socks5 proxy URL (工厂存在性，不真连代理)", () => {
    const f = createProxyFetch("socks5://127.0.0.1:1080");
    expect(f).toBeInstanceOf(Function);
    expect(f).not.toBe(fetch);
    expect(typeof f).toBe("function");
  });

  it("returns a fetch-compatible wrapper for http proxy URL", () => {
    const f = createProxyFetch("http://127.0.0.1:1080");
    expect(f).toBeInstanceOf(Function);
    expect(f).not.toBe(fetch);
  });

  it("rejects malformed proxy URL at construction", () => {
    expect(() => createProxyFetch("not-a-url")).toThrow();
  });
});
