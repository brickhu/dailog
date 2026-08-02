import { describe, expect, it } from "vitest";
import { canGenerate, type QuotaInfo } from "../src/quota";

describe("canGenerate", () => {
  it("free user with 0 generated episodes passes (freebie, no credit)", () => {
    const r = canGenerate({ plan: "free", generatedCount: 0, creditBalance: 0 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.consumeCredit).toBe(0);
  });
  it("free user with >=1 generated episode blocked", () => {
    const r = canGenerate({ plan: "free", generatedCount: 1, creditBalance: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected blocked");
    expect(r.reason).toBe("quota_free_used");
  });
  it("credit user consumes one credit", () => {
    const r = canGenerate({ plan: "free", generatedCount: 1, creditBalance: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected allowed");
    expect(r.consumeCredit).toBe(1);
  });
  it("pro user unlimited", () => {
    expect(canGenerate({ plan: "pro", generatedCount: 99, creditBalance: 0 }).ok).toBe(true);
  });
});
