import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate, A } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@dailogues/ui/theme.stylex";
import { api } from "../lib/client";
import { useAuth } from "../lib/auth";
import { env } from "../lib/env";

// chrome.runtime（扩展注入 token 用；无扩展环境则跳过）
declare const chrome: { runtime?: { sendMessage?: (id: string, msg: unknown) => Promise<unknown> } };

export interface Episode {
  id: string;
  title: string | null;
  status: "draft" | "generating" | "published" | "failed";
  platform: string | null;
  createdAt: string;
}

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

const STATUS_LABEL: Record<Episode["status"], { text: string; color: string }> = {
  draft: { text: "草稿", color: "#8b95a7" },
  generating: { text: "生成中", color: "#e0a23c" },
  published: { text: "已发布", color: "#3fb68b" },
  failed: { text: "生成失败", color: "#f0506e" },
};

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    background: tokens.colorBg,
    color: tokens.colorText,
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: tokens.space6,
  },
  hero: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: tokens.space5,
  },
  title: {
    fontSize: tokens.fontSizeXl,
    fontWeight: tokens.fontWeightBold,
  },
  newButton: {
    padding: `${tokens.space2} ${tokens.space4}`,
    borderRadius: tokens.radiusMd,
    border: "none",
    background: tokens.colorPrimary,
    color: "#fff",
    cursor: "pointer",
    fontSize: tokens.fontSizeMd,
  },
  card: {
    padding: tokens.space4,
    borderRadius: tokens.radiusMd,
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
    marginBottom: tokens.space3,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space3,
  },
  cardMain: {
    minWidth: 0,
  },
  epTitle: {
    fontWeight: tokens.fontWeightMedium,
    fontSize: tokens.fontSizeMd,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  epMeta: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    marginTop: tokens.space1,
  },
  badge: {
    padding: `2px ${tokens.space2}`,
    borderRadius: tokens.radiusFull,
    fontSize: "12px",
    flexShrink: 0,
  },
  extCard: {
    padding: tokens.space5,
    borderRadius: tokens.radiusMd,
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
    marginBottom: tokens.space5,
  },
  extTitle: {
    fontWeight: tokens.fontWeightBold,
    marginBottom: tokens.space2,
  },
  extStep: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeMd,
    lineHeight: 1.7,
    marginBottom: tokens.space1,
  },
  extButton: {
    marginTop: tokens.space3,
    padding: `${tokens.space2} ${tokens.space4}`,
    borderRadius: tokens.radiusMd,
    border: "none",
    background: tokens.colorPrimary,
    color: "#fff",
    cursor: "pointer",
    fontSize: tokens.fontSizeMd,
  },
  extConnected: {
    color: tokens.colorSuccess,
    fontSize: tokens.fontSizeSm,
    marginTop: tokens.space2,
  },
  placeholderRow: {
    display: "flex",
    gap: tokens.space3,
    marginTop: tokens.space5,
  },
  placeholder: {
    flex: 1,
    padding: tokens.space4,
    borderRadius: tokens.radiusMd,
    border: `1px dashed ${tokens.colorBorder}`,
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    textAlign: "center",
  },
  empty: {
    padding: tokens.space7,
    textAlign: "center",
    color: tokens.colorTextMuted,
    border: `1px dashed ${tokens.colorBorder}`,
    borderRadius: tokens.radiusMd,
  },
  error: {
    color: tokens.colorDanger,
    marginBottom: tokens.space3,
  },
  channelBanner: {
    padding: tokens.space3,
    borderRadius: tokens.radiusMd,
    background: "rgba(224, 162, 60, 0.12)",
    border: `1px solid rgba(224, 162, 60, 0.4)`,
    color: tokens.colorWarning,
    fontSize: tokens.fontSizeSm,
    marginBottom: tokens.space4,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space3,
  },
  channelLink: {
    color: tokens.colorWarning,
    fontWeight: tokens.fontWeightMedium,
    textDecoration: "underline",
    flexShrink: 0,
  },
});

export default function Dashboard() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [episodes, setEpisodes] = createSignal<Episode[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [extConnected, setExtConnected] = createSignal(false);
  const [channelActive, setChannelActive] = createSignal(true);

  onMount(async () => {
    try {
      const me = await api.get<{ channelActive: boolean }>("/api/me");
      setChannelActive(me.channelActive);
      setEpisodes(await api.get<Episode[]>("/api/episodes"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  });

  const connectExtension = async () => {
    const token = auth.token();
    if (!token || !env.extensionId) return;
    try {
      await chrome.runtime?.sendMessage?.(env.extensionId, { type: "dailogues:set-token", token });
      setExtConnected(true);
    } catch {
      setError("连接扩展失败：请确认已安装扩展并允许站点访问");
    }
  };

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.hero)}>
          <div {...stylex.props(styles.title)}>我的节目</div>
          <button {...stylex.props(styles.newButton)} onClick={() => navigate("/episodes/new")}>
            开始新节目
          </button>
        </div>

        <Show when={!channelActive()}>
          <div {...stylex.props(styles.channelBanner)}>
            <span>你的频道尚未开通：开通后才能生成和发布节目</span>
            <A href="/onboarding" {...stylex.props(styles.channelLink)}>
              去开通 →
            </A>
          </div>
        </Show>

        <Show when={!extConnected() && env.extensionId}>
          <div {...stylex.props(styles.extCard)}>
            <div {...stylex.props(styles.extTitle)}>用浏览器扩展采集对话</div>
            <div {...stylex.props(styles.extStep)}>1. 安装 dailogues 采集扩展（Chrome 商店）</div>
            <div {...stylex.props(styles.extStep)}>
              2. 打开你的 ChatGPT / Claude / DeepSeek 对话页，点击扩展采集
            </div>
            <div {...stylex.props(styles.extStep)}>3. 回到这里继续编辑发布</div>
            <button {...stylex.props(styles.extButton)} onClick={connectExtension}>
              连接扩展
            </button>
            <Show when={extConnected()}>
              <div {...stylex.props(styles.extConnected)}>扩展已连接 ✓</div>
            </Show>
          </div>
        </Show>

        <Show when={error()}>
          <div {...stylex.props(styles.error)}>{error()}</div>
        </Show>

        <Show when={!loading() && episodes().length === 0}>
          <div {...stylex.props(styles.empty)}>
            还没有节目。安装扩展、打开 AI 对话页点击采集，第一期的内容就有了。
          </div>
        </Show>

        <For each={episodes()}>
          {(ep) => {
            const status = STATUS_LABEL[ep.status] ?? STATUS_LABEL.draft;
            return (
              <div {...stylex.props(styles.card)}>
                <div {...stylex.props(styles.cardMain)}>
                  <div {...stylex.props(styles.epTitle)}>{ep.title || "未命名对话"}</div>
                  <div {...stylex.props(styles.epMeta)}>
                    {PLATFORM_LABEL[ep.platform ?? ""] ?? ep.platform ?? "导入"} ·{" "}
                    {new Date(ep.createdAt).toLocaleDateString("zh-CN")}
                  </div>
                </div>
                <span
                  {...stylex.props(styles.badge)}
                  style={{ background: `${status.color}22`, color: status.color }}
                >
                  {status.text}
                </span>
              </div>
            );
          }}
        </For>

        <div {...stylex.props(styles.placeholderRow)}>
          <div {...stylex.props(styles.placeholder)}>邀请好友（计划 7）</div>
          <div {...stylex.props(styles.placeholder)}>订阅 Pro（计划 7）</div>
        </div>
      </div>
    </div>
  );
}
