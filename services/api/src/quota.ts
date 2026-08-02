export interface QuotaInfo {
  plan: "free" | "pro";
  generatedCount: number; // 已完成生成（job done）的期数
  creditBalance: number;
}

/**
 * 生成配额判定（PRD §4.4）：
 * - pro：无限，不扣积分
 * - free：首集免费；之后每集消耗 1 积分（credit_balance > 0 时可用）
 */
export function canGenerate(q: QuotaInfo): { ok: true; consumeCredit: number } | { ok: false; reason: string } {
  if (q.plan === "pro") return { ok: true, consumeCredit: 0 };
  if (q.generatedCount >= 1 && q.creditBalance <= 0) return { ok: false, reason: "quota_free_used" };
  return { ok: true, consumeCredit: 1 };
}
