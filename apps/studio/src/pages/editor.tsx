import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { api } from "../lib/client";
import ScriptEditor from "../components/script-editor";
import GenerateProgress from "../components/generate-progress";
import type { Episode } from "./episodes";

const PLATFORM_LABEL: Record<string, string> = {
  deepseek: "DeepSeek",
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  kimi: "Kimi",
  doubao: "豆包",
  tongyi: "通义",
  plain: "其他",
};

const STEPS = ["选对话", "润色编辑", "生成", "发布"];

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing4,
    padding: `${dimensions.spacing3} ${dimensions.spacing8}`,
    borderBottom: `1px solid ${colors.ink}`,
  },
  back: {
    backgroundColor: "transparent",
    border: "none",
    color: colors.neutral,
    cursor: "pointer",
    fontSize: dimensions.fontSizeMd,
  },
  steps: {
    display: "flex",
    gap: dimensions.spacing2,
    fontSize: dimensions.fontSizeSm,
  },
  step: {
    color: colors.neutral,
  },
  stepActive: {
    color: colors.primary,
    fontWeight: dimensions.fontWeightMedium,
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing8,
  },
  pickTitle: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing2,
  },
  pickHint: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing6,
  },
  card: {
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing3,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dimensions.spacing3,
  },
  cardMain: {
    minWidth: 0,
  },
  cardTitle: {
    fontWeight: dimensions.fontWeightMedium,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardMeta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing1,
  },
  empty: {
    padding: dimensions.spacing12,
    textAlign: "center",
    color: colors.neutral,
    border: `1px dashed ${colors.ink}`,
    borderRadius: dimensions.radiusMd,
  },
  emptyAction: {
    marginTop: dimensions.spacing4,
  },
  publishedBox: {
    padding: dimensions.spacing8,
    borderRadius: dimensions.radiusXl,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    textAlign: "center",
  },
  publishedTitle: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    color: colors.success,
    marginBottom: dimensions.spacing3,
  },
  publishedDesc: {
    color: colors.neutral,
    lineHeight: 1.7,
    marginBottom: dimensions.spacing4,
  },
  field: {
    marginBottom: dimensions.spacing4,
  },
  label: {
    display: "block",
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing1,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    background: colors.background,
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    fontFamily: "inherit",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: dimensions.spacing2,
    marginTop: dimensions.spacing6,
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  error: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing3,
  },
});

export default function NewEpisode() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const routeParams = useParams();
  // 兼容两种入口：/episodes/new?id=<id>（向导）与 /episodes/<id>（确认页入库后直达编辑）
  const paramId =
    (typeof params.id === "string" && params.id) ||
    (typeof routeParams.id === "string" && routeParams.id) ||
    null;
  const [step, setStep] = createSignal<1 | 2 | 3 | 4>(paramId ? 2 : 1);
  const [episodeId, setEpisodeId] = createSignal<string | null>(paramId);
  const [episodes, setEpisodes] = createSignal<Episode[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [polishedVersion, setPolishedVersion] = createSignal<number | null>(null);
  const [generated, setGenerated] = createSignal(false);
  const [published, setPublished] = createSignal(false);
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [publishBusy, setPublishBusy] = createSignal(false);

  onMount(async () => {
    if (step() !== 1) return;
    try {
      const list = await api.get<Episode[]>("/api/episodes");
      setEpisodes(list);
      // ③④ 需要预填标题：从当前 episode 列表找
      const cur = list.find((e) => e.id === episodeId());
      if (cur?.title) setTitle(cur.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  });

  const pick = (id: string) => {
    setEpisodeId(id);
    const ep = episodes().find((e) => e.id === id);
    if (ep?.title) setTitle(ep.title);
    setStep(2);
  };

  const publish = async () => {
    if (!episodeId()) return;
    setPublishBusy(true);
    try {
      await api.post(`/api/episodes/${episodeId()}/publish`);
      setPublished(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "发布失败");
    } finally {
      setPublishBusy(false);
    }
  };

  return (
    <div {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <button {...stylex.props(styles.back)} onClick={() => navigate("/episodes")}>
          ← 返回
        </button>
        <div {...stylex.props(styles.steps)}>
          <For each={STEPS}>
            {(label, i) => (
              <span
                {...stylex.props(styles.step, i() + 1 === step() && styles.stepActive)}
              >
                {i() + 1}. {label}
                {i() < STEPS.length - 1 && " → "}
              </span>
            )}
          </For>
        </div>
      </header>

      <div {...stylex.props(styles.content)}>
        <Show when={error()}>
          <div {...stylex.props(styles.error)}>{error()}</div>
        </Show>

        <Show when={step() === 1}>
          <div {...stylex.props(styles.pickTitle)}>选择要制作的对话</div>
          <div {...stylex.props(styles.pickHint)}>
            粘贴 AI 对话分享链接导入，或选择已有对话
          </div>
          <Show when={episodes().length === 0}>
            <div {...stylex.props(styles.empty)}>
              还没有导入的对话。粘贴 Claude / ChatGPT / DeepSeek / Gemini / Kimi / 豆包 的对话分享链接即可导入。
              <div {...stylex.props(styles.emptyAction)}>
                <Button onClick={() => navigate("/import")}>从分享链接导入</Button>
              </div>
            </div>
          </Show>
          <For each={episodes()}>
            {(ep) => (
              <div {...stylex.props(styles.card)} onClick={() => pick(ep.id)}>
                <div {...stylex.props(styles.cardMain)}>
                  <div {...stylex.props(styles.cardTitle)}>{ep.title || "未命名对话"}</div>
                  <div {...stylex.props(styles.cardMeta)}>
                    {PLATFORM_LABEL[ep.platform ?? ""] ?? ep.platform ?? "导入"} ·{" "}
                    {new Date(ep.createdAt).toLocaleDateString("zh-CN")}
                  </div>
                </div>
                <span {...stylex.props(styles.cardMeta)}>选择 →</span>
              </div>
            )}
          </For>
        </Show>

        <Show when={step() === 2 && episodeId()}>
          <ScriptEditor
            episodeId={episodeId()!}
            onDone={(version) => setPolishedVersion(version)}
          />
          <div {...stylex.props(styles.actions)}>
            <Button appear="ghost" onClick={() => setStep(1)}>上一步</Button>
            <Button disabled={!polishedVersion()} onClick={() => setStep(3)}>下一步：生成音频</Button>
          </div>
        </Show>

        <Show when={step() === 3 && episodeId()}>
          <GenerateProgress
            episodeId={episodeId()!}
            onDone={() => setGenerated(true)}
            onFailed={(msg) => setError(`生成失败：${msg}`)}
            onQuotaDenied={() => setStep(2)}
          />
          <div {...stylex.props(styles.actions)}>
            <Button appear="ghost" onClick={() => setStep(2)}>{generated() ? "不满意，回去改" : "上一步"}</Button>
            <Show when={generated()}>
              <Button onClick={() => setStep(4)}>下一步：发布</Button>
            </Show>
          </div>
        </Show>

        <Show when={step() === 4 && episodeId()}>
          <Show
            when={!published()}
            fallback={
              <div {...stylex.props(styles.publishedBox)}>
                <div {...stylex.props(styles.publishedTitle)}>节目已发布 ✓</div>
                <div {...stylex.props(styles.publishedDesc)}>
                  播放页即将上线（内容站开发中）。发布满 3 期后，每发布一期可获得一个邀请码，邀请好友加入。
                </div>
                <Button onClick={() => navigate("/episodes")}>返回工作台</Button>
              </div>
            }
          >
            <div {...stylex.props(styles.publishedBox)}>
              <div {...stylex.props(styles.publishedTitle)}>发布你的节目</div>
              <div {...stylex.props(styles.field)}>
                <label {...stylex.props(styles.label)}>标题</label>
                <input
                  {...stylex.props(styles.input)}
                  value={title()}
                  onInput={(e) => setTitle(e.currentTarget.value)}
                />
              </div>
              <div {...stylex.props(styles.field)}>
                <label {...stylex.props(styles.label)}>描述（可选）</label>
                <textarea
                  {...stylex.props(styles.input)}
                  rows={3}
                  value={description()}
                  onInput={(e) => setDescription(e.currentTarget.value)}
                />
              </div>
              <div {...stylex.props(styles.actions)}>
                <Button appear="ghost" onClick={() => setStep(3)}>上一步</Button>
                <Button onClick={publish} disabled={publishBusy()}>{publishBusy() ? "发布中…" : "发布"}</Button>
              </div>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
