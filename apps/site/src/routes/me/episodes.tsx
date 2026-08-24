import { A, createAsync } from "@solidjs/router";
import { For, Show, createSignal } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { AuthGate } from "../../components/auth-gate";
import { PageSpinner } from "../../components/page-loading";

// 我的节目（/me/episodes）：已发布节目只读列表 + 申请下线（编辑审批）。
// 内容策展权在平台：节目信息与公开状态由编辑端维护，用户不能自助修改/下架；
// 下线需提交申请，由编辑审批（通过 → isPublic=false，仅自己可见）。
interface MyEpisode {
  id: string;
  slug: string;
  title: string | null;
  number: number | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  isPublic: boolean;
  isPicked: boolean;
  removalRequest: { status: "pending" | "approved" | "rejected" } | null;
}

const styles = stylex.create({
  page: { minHeight: "100vh", backgroundColor: colors.background, color: colors.foreground, fontFamily: "system-ui, -apple-system, sans-serif" },
  content: { maxWidth: "720px", margin: "0 auto", padding: dimensions.spacing8, paddingBottom: "72px" },
  title: { fontSize: dimensions.fontSize2xl, fontWeight: dimensions.fontWeightBold, marginBottom: dimensions.spacing2 },
  feedback: { color: colors.primary, fontSize: dimensions.fontSizeSm, marginBottom: dimensions.spacing4 },
  error: { color: colors.danger, fontSize: dimensions.fontSizeSm, marginBottom: dimensions.spacing4 },
  card: { display: "flex", flexDirection: "column", gap: dimensions.spacing2, padding: dimensions.spacing4, borderRadius: dimensions.radiusMd, backgroundColor: colors.surface, marginBottom: dimensions.spacing3 },
  cardTitleRow: { display: "flex", alignItems: "baseline", gap: dimensions.spacing2, flexWrap: "wrap" },
  epTitle: { fontWeight: dimensions.fontWeightMedium },
  badge: { padding: "2px 8px", borderRadius: dimensions.radiusFull, fontSize: "12px", border: "none" },
  badgePublic: { backgroundColor: colors.surfaceStrong, color: colors.foreground },
  badgeUnlisted: { backgroundColor: colors.surfaceStrong, color: colors.neutral },
  badgePending: { backgroundColor: colors.surfaceStrong, color: colors.primary },
  badgeRejected: { backgroundColor: colors.surfaceStrong, color: colors.danger },
  meta: { color: colors.neutral, fontSize: dimensions.fontSizeSm },
  actions: { display: "flex", alignItems: "center", gap: dimensions.spacing3 },
  actionBtn: { padding: `${dimensions.spacing1} ${dimensions.spacing4}`, borderRadius: dimensions.radiusFull, backgroundColor: "transparent", fontSize: dimensions.fontSizeSm, cursor: "pointer", border: "none", ":hover": { opacity: 0.8 } },
  dangerBtn: { color: colors.danger },
  hint: { fontSize: "12px", color: colors.neutral },
  input: { padding: `${dimensions.spacing1} ${dimensions.spacing2}`, borderRadius: dimensions.radiusSm, border: "none", backgroundColor: colors.background, color: colors.foreground, fontFamily: "inherit", fontSize: dimensions.fontSizeSm },
  requestPanel: { display: "flex", flexDirection: "column", gap: dimensions.spacing2, padding: dimensions.spacing3, marginTop: dimensions.spacing2, borderRadius: dimensions.radiusMd, backgroundColor: colors.surfaceStrong },
  empty: { color: colors.neutral, textAlign: "center", padding: dimensions.spacing12 },
  submitLink: { color: colors.primary, textDecoration: "none", marginLeft: dimensions.spacing2 },
});

function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
}

function EpisodesList() {
  const { t } = useI18n();
  const [episodes, setEpisodes] = createSignal<MyEpisode[] | null>(null);
  const [feedback, setFeedback] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [requestOpenId, setRequestOpenId] = createSignal<string | null>(null);
  const [requestReason, setRequestReason] = createSignal("");
  const [requestBusy, setRequestBusy] = createSignal(false);

  createAsync<MyEpisode[] | null>(async () => {
    if (typeof window === "undefined") return null;
    try {
      const res = await fetch("/v1/me/episodes");
      if (!res.ok) return [];
      const list = (await res.json()) as MyEpisode[];
      setEpisodes(list);
      return list;
    } catch {
      setEpisodes([]);
      return [];
    }
  });

  const patchEpisode = (id: string, patch: Partial<MyEpisode>) =>
    setEpisodes((prev) => prev?.map((e) => (e.id === id ? { ...e, ...patch } : e)) ?? null);

  // 申请下线：提交后由编辑审批；本地置为 pending 状态
  const submitRequest = async (ep: MyEpisode) => {
    setRequestBusy(true);
    setError(null);
    try {
      const res = await fetch("/v1/me/episodes/" + ep.id + "/unpublish-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: requestReason() }),
      });
      if (!res.ok) { setError(t("me.actionFailed")); return; }
      patchEpisode(ep.id, { removalRequest: { status: "pending" } });
      setRequestOpenId(null);
      setRequestReason("");
      setFeedback(t("me.requestRemovalSent"));
    } catch {
      setError(t("me.actionFailed"));
    } finally {
      setRequestBusy(false);
    }
  };

  return (
  <div {...stylex.props(layouts.page)}>
    <div {...stylex.props(layouts.containerSm)}>
      <div {...stylex.props(layouts.fullRow, styles.title)}>{t("me.episodes")}</div>
      <Show when={feedback()}><div {...stylex.props(layouts.fullRow, styles.feedback)}>{feedback()}</div></Show>
      <Show when={error()}><div {...stylex.props(layouts.fullRow, styles.error)}>{error()}</div></Show>
      <Show when={episodes() !== null} fallback={<PageSpinner />}>
      <Show when={episodes()?.length} fallback={<div {...stylex.props(styles.empty)}><span>{t("me.episodesEmpty")}</span><A href="/submit" {...stylex.props(styles.submitLink)}>{t("meSubmits.submit")} →</A></div>}>
        <For each={episodes()}>
          {(ep) => (
            <div {...stylex.props(styles.card)}>
              <div {...stylex.props(styles.cardTitleRow)}>
                <A href={"/episode/" + ep.slug} style={{ color: "inherit", "text-decoration": "none" }}>
                  <span {...stylex.props(styles.epTitle)}>{ep.title || t("common.unnamed")}</span>
                </A>
                <span {...stylex.props(styles.badge, ep.isPublic ? styles.badgePublic : styles.badgeUnlisted)}>
                  {ep.isPublic ? t("me.statusPublic") : t("me.statusUnlisted")}
                </span>
                <Show when={ep.removalRequest?.status === "pending"}>
                  <span {...stylex.props(styles.badge, styles.badgePending)}>{t("me.removalPending")}</span>
                </Show>
                <Show when={ep.removalRequest?.status === "rejected"}>
                  <span {...stylex.props(styles.badge, styles.badgeRejected)}>{t("me.removalRejected")}</span>
                </Show>
              </div>
              <div {...stylex.props(styles.meta)}>
                {ep.number ? "第 " + ep.number + " 期" : ""}
                {ep.publishedAt ? " · " + new Date(ep.publishedAt).toLocaleDateString("zh-CN") : ""}
                {ep.durationSeconds ? " · " + fmtDuration(ep.durationSeconds) : ""}
              </div>
              <Show when={requestOpenId() === ep.id}>
                <div {...stylex.props(styles.requestPanel)}>
                  <div {...stylex.props(styles.hint)}>{t("me.requestRemovalConfirm")}</div>
                  <input value={requestReason()} maxLength={500} placeholder={t("me.requestRemovalReason")} onInput={(e) => setRequestReason(e.currentTarget.value)} {...stylex.props(styles.input)} />
                  <div {...stylex.props(styles.actions)}>
                    <button type="button" disabled={requestBusy()} {...stylex.props(styles.actionBtn, styles.dangerBtn)} onClick={() => submitRequest(ep)}>{t("me.requestRemoval")}</button>
                    <button type="button" {...stylex.props(styles.actionBtn)} onClick={() => { setRequestOpenId(null); setRequestReason(""); }}>{t("common.cancel")}</button>
                  </div>
                </div>
              </Show>
              <Show when={ep.isPublic && ep.removalRequest?.status !== "pending"}>
                <div {...stylex.props(styles.actions)}>
                  <button type="button" {...stylex.props(styles.actionBtn, styles.dangerBtn)} onClick={() => setRequestOpenId(requestOpenId() === ep.id ? null : ep.id)}>{t("me.requestRemoval")}</button>
                </div>
              </Show>
            </div>
          )}
        </For>
      </Show>
      </Show>
    </div>
  </div>
  );
}

export default function MeEpisodesPage() {
  const { t } = useI18n();
  return (
      <AuthGate redirect="/me/episodes">
        <Title>{t("me.episodes")} · dailog</Title>
        <EpisodesList />
      </AuthGate>
  );
}
