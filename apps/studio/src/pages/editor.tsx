import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { api } from "../lib/client";
import ScriptEditor from "../components/script-editor";
import GenerateProgress from "../components/generate-progress";
import type { ScriptSegment } from "../lib/scriptOps";

// /polish/:id 编辑页：创作容器（polish）→ 润色生成 transcripts（可多条）→ 选定一条生成节目 → 发布。
// 导入页确认创建容器后直达本页；重复粘贴分享链接也会跳转到这里（继续创作）。

interface Transcript {
  id: string;
  language: string | null;
  createdAt: string;
  segments?: ScriptSegment[];
}

interface PolishDetail {
  id: string;
  title: string | null;
  snapshotTitle: string | null;
  snapshotUrl: string | null;
  quality: { pass: boolean; reason?: string; language?: string } | null;
  transcripts: Transcript[];
}

const styles = stylex.create({
  page: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing6,
    color: colors.foreground,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: dimensions.spacing4,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
  },
  subtitle: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing1,
  },
  warn: {
    backgroundColor: "#fffbeb",
    color: "#92400e",
    border: `1px solid #fde68a`,
    borderRadius: dimensions.radiusMd,
    padding: dimensions.spacing3,
    fontSize: dimensions.fontSizeSm,
    lineHeight: "1.5",
    marginBottom: dimensions.spacing4,
  },
  section: {
    marginBottom: dimensions.spacing6,
  },
  sectionTitle: {
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing3,
  },
  transcriptCard: {
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing2,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dimensions.spacing3,
    cursor: "pointer",
  },
  transcriptCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  transcriptMeta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  actions: {
    display: "flex",
    gap: dimensions.spacing3,
    marginTop: dimensions.spacing3,
  },
  error: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing3,
  },
  empty: {
    padding: dimensions.spacing6,
    textAlign: "center",
    color: colors.neutral,
    border: `1px dashed ${colors.ink}`,
    borderRadius: dimensions.radiusMd,
  },
});

export default function PolishPage() {
  const navigate = useNavigate();
  const params = useParams();
  const polishId = typeof params.id === "string" ? params.id : null;
  const [detail, setDetail] = createSignal<PolishDetail | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [activeTranscriptId, setActiveTranscriptId] = createSignal<string | null>(null);
  const [activeSegments, setActiveSegments] = createSignal<ScriptSegment[] | null>(null);
  const [generating, setGenerating] = createSignal(false);
  const [episodeId, setEpisodeId] = createSignal<string | null>(null);
  const [generated, setGenerated] = createSignal(false);
  const [published, setPublished] = createSignal(false);
  const [title, setTitle] = createSignal("");
  const [publishBusy, setPublishBusy] = createSignal(false);

  const load = async () => {
    if (!polishId) return;
    setLoading(true);
    try {
      const d = await api.get<PolishDetail>(`/api/polishes/${polishId}`);
      setDetail(d);
      if (d.transcripts.length > 0) {
        const latest = d.transcripts[0];
        setActiveTranscriptId(latest.id);
        setActiveSegments(latest.segments ?? null);
      }
      setTitle(d.title ?? d.snapshotTitle ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  onMount(load);

  const selectTranscript = (t: Transcript) => {
    setActiveTranscriptId(t.id);
    setActiveSegments(t.segments ?? null);
    setGenerated(false);
    setEpisodeId(null);
  };

  /** 生成节目（选定 transcript） */
  const generateEpisode = async () => {
    if (!activeTranscriptId() || generating()) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await api.request("/api/episodes/new", {
        method: "POST",
        body: JSON.stringify({
          transcriptId: activeTranscriptId(),
          title: title() || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as { episodeId?: string; error?: string; reason?: string } | null;
      if (res.ok && body?.episodeId) {
        setEpisodeId(body.episodeId);
        return;
      }
      if (res.status === 422) setError(`审核未通过：${body?.reason ?? body?.error}`);
      else if (res.status === 403) setError(body?.error === "quota_exceeded" ? "配额不足" : "请先开通频道");
      else setError(body?.error ?? `生成失败（HTTP ${res.status}）`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
    }
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
        <div>
          <div {...stylex.props(styles.title)}>{detail()?.snapshotTitle ?? detail()?.title ?? "创作容器"}</div>
          <div {...stylex.props(styles.subtitle)}>
            {detail()?.snapshotUrl ? (
              <a href={detail()!.snapshotUrl!} target="_blank" style={{ color: colors.primary }}>
                {detail()!.snapshotUrl}
              </a>
            ) : ""}
          </div>
        </div>
        <Button appear="ghost" onClick={() => navigate("/episodes")}>我的节目</Button>
      </header>

      <Show when={loading()}>
        <div {...stylex.props(styles.subtitle)}>加载中…</div>
      </Show>
      <Show when={error() && !loading()}>
        <div {...stylex.props(styles.error)}>{error()}</div>
      </Show>

      <Show when={!loading() && detail()}>
        {/* 质量提示 */}
        <Show when={detail()!.quality && !detail()!.quality!.pass}>
          <div {...stylex.props(styles.warn)}>
            ⚠️ 质量检测未通过：{detail()!.quality!.reason ?? "内容可能不适合制作节目"}。仍可继续。
          </div>
        </Show>

        {/* 润色脚本列表 */}
        <div {...stylex.props(styles.section)}>
          <div {...stylex.props(styles.sectionTitle)}>润色脚本（可生成多条，选一条做节目）</div>
          <Show
            when={detail()!.transcripts.length > 0}
            fallback={<div {...stylex.props(styles.empty)}>还没有脚本。在下方点击「生成新脚本」开始润色。</div>}
          >
            <For each={detail()!.transcripts}>
              {(t) => (
                <div
                  {...stylex.props(styles.transcriptCard, t.id === activeTranscriptId() && styles.transcriptCardActive)}
                  onClick={() => selectTranscript(t)}
                >
                  <div>
                    <div>脚本 #{detail()!.transcripts.indexOf(t) + 1}</div>
                    <div {...stylex.props(styles.transcriptMeta)}>
                      {new Date(t.createdAt).toLocaleString("zh-CN")}
                    </div>
                  </div>
                  <span {...stylex.props(styles.transcriptMeta)}>{t.id === activeTranscriptId() ? "编辑中 →" : "选择"}</span>
                </div>
              )}
            </For>
          </Show>
        </div>

        {/* 编辑器（无 active transcript 时显示生成入口） */}
        <div {...stylex.props(styles.section)}>
          <ScriptEditor
            polishId={polishId!}
            transcriptId={activeTranscriptId()}
            initialSegments={activeSegments() ?? undefined}
            onDone={() => {
              void load(); // 新脚本生成完成：刷新列表
            }}
          />
          <div {...stylex.props(styles.actions)}>
            <Button
              disabled={!activeTranscriptId() || generating()}
              onClick={generateEpisode}
            >
              {generating() ? "生成中…" : "用当前脚本生成节目"}
            </Button>
          </div>
        </div>

        {/* 生成进度 + 发布 */}
        <Show when={episodeId()}>
          <div {...stylex.props(styles.section)}>
            <GenerateProgress
              episodeId={episodeId()!}
              onDone={() => setGenerated(true)}
              onFailed={(msg) => setError(`生成失败：${msg}`)}
              onQuotaDenied={() => setError("配额不足")}
            />
            <Show when={generated()}>
              <div {...stylex.props(styles.sectionTitle)}>发布节目</div>
              <div {...stylex.props(styles.transcriptCard)}>
                <div>
                  <div>标题</div>
                  <input
                    style={{ width: "100%", padding: "8px" }}
                    value={title()}
                    onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)}
                  />
                </div>
              </div>
              <div {...stylex.props(styles.actions)}>
                <Show
                  when={!published()}
                  fallback={<div {...stylex.props(styles.subtitle)}>节目已发布 ✓</div>}
                >
                  <Button onClick={publish} disabled={publishBusy()}>
                    {publishBusy() ? "发布中…" : "发布"}
                  </Button>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}
