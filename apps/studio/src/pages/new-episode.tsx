import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex.ts";
import { api } from "../lib/client";
import ScriptEditor from "../components/script-editor";
import type { Episode } from "./dashboard";

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
    background: tokens.colorBg,
    color: tokens.colorText,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space4,
    padding: `${tokens.space3} ${tokens.space6}`,
    borderBottom: `1px solid ${tokens.colorBorder}`,
  },
  back: {
    background: "transparent",
    border: "none",
    color: tokens.colorTextMuted,
    cursor: "pointer",
    fontSize: tokens.fontSizeMd,
  },
  steps: {
    display: "flex",
    gap: tokens.space2,
    fontSize: tokens.fontSizeSm,
  },
  step: {
    color: tokens.colorTextMuted,
  },
  stepActive: {
    color: tokens.colorPrimary,
    fontWeight: tokens.fontWeightMedium,
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: tokens.space6,
  },
  pickTitle: {
    fontSize: tokens.fontSizeXl,
    fontWeight: tokens.fontWeightBold,
    marginBottom: tokens.space2,
  },
  pickHint: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    marginBottom: tokens.space5,
  },
  card: {
    padding: tokens.space4,
    borderRadius: tokens.radiusMd,
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
    marginBottom: tokens.space3,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space3,
  },
  cardMain: {
    minWidth: 0,
  },
  cardTitle: {
    fontWeight: tokens.fontWeightMedium,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardMeta: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    marginTop: tokens.space1,
  },
  empty: {
    padding: tokens.space7,
    textAlign: "center",
    color: tokens.colorTextMuted,
    border: `1px dashed ${tokens.colorBorder}`,
    borderRadius: tokens.radiusMd,
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: tokens.space2,
    marginTop: tokens.space5,
  },
  button: {
    padding: `${tokens.space2} ${tokens.space5}`,
    borderRadius: tokens.radiusMd,
    border: "none",
    background: tokens.colorPrimary,
    color: "#fff",
    cursor: "pointer",
    fontSize: tokens.fontSizeMd,
  },
  buttonGhost: {
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
    color: tokens.colorText,
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  error: {
    color: tokens.colorDanger,
    fontSize: tokens.fontSizeSm,
    marginBottom: tokens.space3,
  },
});

export default function NewEpisode() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const paramId = typeof params.id === "string" ? params.id : null;
  const [step, setStep] = createSignal<1 | 2 | 3 | 4>(paramId ? 2 : 1);
  const [episodeId, setEpisodeId] = createSignal<string | null>(paramId);
  const [episodes, setEpisodes] = createSignal<Episode[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [polishedVersion, setPolishedVersion] = createSignal<number | null>(null);

  onMount(async () => {
    if (step() !== 1) return;
    try {
      setEpisodes(await api.get<Episode[]>("/api/episodes"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  });

  const pick = (id: string) => {
    setEpisodeId(id);
    setStep(2);
  };

  return (
    <div {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <button {...stylex.props(styles.back)} onClick={() => navigate("/dashboard")}>
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
            用浏览器扩展在 AI 对话页采集后，对话会出现在这里
          </div>
          <Show when={episodes().length === 0}>
            <div {...stylex.props(styles.empty)}>
              还没有导入的对话。打开 AI 对话页（DeepSeek / Claude / ChatGPT…），点击扩展采集。
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
            <button {...stylex.props(styles.buttonGhost)} onClick={() => setStep(1)}>
              上一步
            </button>
            <button
              {...stylex.props(styles.button)}
              disabled={!polishedVersion()}
              onClick={() => setStep(3)}
            >
              下一步：生成音频
            </button>
          </div>
        </Show>

        <Show when={step() === 3 || step() === 4}>
          <div {...stylex.props(styles.empty)}>生成与发布（Task 7 实现中）</div>
        </Show>
      </div>
    </div>
  );
}
