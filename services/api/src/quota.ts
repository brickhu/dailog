export interface QuotaInfo {
  plan: "free" | "pro";
  generatedCount: number; // 已完成生成（job done）的期数
  creditBalance: number;
}

/**
 * 生成配额判定（PRD §4.7 计费模型 v2：按脚本字数计费）。
 *
 * ⚠️ 过渡实现：当前仍为"期数制"（首期免费、之后每期 1 credit），
 * 计划 7 将改为**字数制**——consumeCredit 语义变为按最新脚本总字符数扣减，
 * 并新增：脚本 5000 字硬上限校验、免费用户润色限次（3 次/日）。
 * 在此之前此函数保持期数制占位（首期免费逻辑不变，保证免费体验可用）。
 */
export function canGenerate(q: QuotaInfo): { ok: true; consumeCredit: number } | { ok: false; reason: string } {
  if (q.plan === "pro") return { ok: true, consumeCredit: 0 };
  // 免费额度：首期不扣 credit；之后每期扣 1 credit（计划 7 起按字数扣减）
  if (q.generatedCount >= 1) {
    if (q.creditBalance <= 0) return { ok: false, reason: "quota_free_used" };
    return { ok: true, consumeCredit: 1 };
  }
  return { ok: true, consumeCredit: 0 };
}
