import { createSignal, onMount, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button, TextField } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import VoiceSampler from "../components/voice-sampler";
import { api } from "../lib/client";
import { ApiError } from "../lib/api";
import { uploadVoiceSample, HOST_READING_SCRIPT } from "../lib/voice";
import { env } from "../lib/env";

/** GET /api/me/profile 返回的频道字段 */
interface ChannelProfile {
  username: string | null;
  displayName: string | null;
  bio: string | null;
  channelActivatedAt: string | null;
}

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing8,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing6,
  },
  card: {
    padding: dimensions.spacing6,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing4,
  },
  cardTitle: {
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing2,
  },
  cardDesc: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing3,
    lineHeight: 1.6,
  },
  status: {
    fontSize: dimensions.fontSizeSm,
    color: colors.neutral,
    marginTop: dimensions.spacing2,
  },
  statusOk: {
    color: colors.success,
  },
  statusFail: {
    color: colors.danger,
  },
  placeholder: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  slugStatus: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginTop: "-8px",
    marginBottom: "12px",
  },
  slugOk: {
    color: colors.success,
  },
  slugTaken: {
    color: colors.danger,
  },
  error: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing2,
  },
});

export default function Settings() {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [sample, setSample] = createSignal<{ id: string | null; status: string; duration: number } | null>(null);

  // ---- 频道设置 ----
  const [channel, setChannel] = createSignal<ChannelProfile | null>(null);
  const [slug, setSlug] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [bio, setBio] = createSignal("");
  const [channelMsg, setChannelMsg] = createSignal<{ ok: boolean; text: string } | null>(null);
  const [channelBusy, setChannelBusy] = createSignal(false);
  // slug 实时占用检测：idle（未检测/自己当前值）/ checking / ok / taken / invalid
  const [slugCheck, setSlugCheck] = createSignal<"idle" | "checking" | "ok" | "taken" | "invalid">("idle");
  let slugCheckTimer: ReturnType<typeof setTimeout> | undefined;

  /** slug 输入：小写化 + 防抖 400ms 调占用检测（自己当前值跳过；保存时后端仍兜底 409） */
  const onSlugInput = (v: string) => {
    const value = v.toLowerCase();
    setSlug(value);
    setChannelMsg(null);
    clearTimeout(slugCheckTimer);
    const trimmed = value.trim();
    if (!trimmed || trimmed === channel()?.username) {
      setSlugCheck("idle");
      return;
    }
    if (!/^[a-z0-9-]{3,30}$/.test(trimmed)) {
      setSlugCheck("invalid");
      return;
    }
    setSlugCheck("checking");
    slugCheckTimer = setTimeout(async () => {
      try {
        const r = await api.get<{ available: boolean }>(`/api/me/channel/check?username=${encodeURIComponent(trimmed)}`);
        setSlugCheck(r.available ? "ok" : "taken");
      } catch {
        setSlugCheck("idle"); // 检测失败静默（保存时后端兜底）
      }
    }, 400);
  };

  onMount(async () => {
    await refreshSample();
    // 频道档案（slug/频道名/简介）
    try {
      const p = await api.get<ChannelProfile>("/api/me/profile");
      setChannel(p);
      setSlug(p.username ?? "");
      setDisplayName(p.displayName ?? "");
      setBio(p.bio ?? "");
    } catch {
      // 加载失败静默（表单留空可重填）
    }
  });

  /** 拉取最新采样（含 id——VoiceSampler 靠它切播放/录音视图） */
  const refreshSample = async () => {
    try {
      const s = await api.get<{ id: string | null; status: string; duration: number }>("/api/me/voice-sample");
      setSample(s);
    } catch {
      setSample(null); // 从未录制
    }
  };

  /** 保存频道设置：slug 小写化 + 格式/占用错误提示 */
  const saveChannel = async () => {
    setChannelMsg(null);
    setChannelBusy(true);
    try {
      await api.patch("/api/me/channel", { username: slug(), displayName: displayName(), bio: bio() });
      setChannel((c) => ({ ...(c ?? { channelActivatedAt: null }), username: slug(), displayName: displayName(), bio: bio() }));
      setChannelMsg({ ok: true, text: "已保存——频道页地址即刻生效" });
    } catch (e) {
      if (e instanceof ApiError) {
        setChannelMsg(
          e.status === 409
            ? { ok: false, text: "该频道地址已被占用，换一个试试" }
            : { ok: false, text: e.code === "invalid_username" ? "频道地址仅限 3-30 位小写字母、数字、连字符" : "保存失败，请检查输入" },
        );
      } else {
        setChannelMsg({ ok: false, text: "保存失败，请重试" });
      }
    } finally {
      setChannelBusy(false);
    }
  };

  const submit = async (b: Blob) => {
    setBusy(true);
    setError(null);
    try {
      await uploadVoiceSample(b, HOST_READING_SCRIPT); // 重录同样照固定文案读
      await refreshSample(); // 重新拉取拿新 id → VoiceSampler 自动回播放视图
    } catch (e) {
      if (e instanceof ApiError && e.status === 502) {
        setError("采样保存失败（可能是存储服务异常）。已录音，请重试。");
      } else {
        setError(e instanceof Error ? e.message : "上传失败");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.title)}>设置</div>

        <div {...stylex.props(styles.card)}>
          <div {...stylex.props(styles.cardTitle)}>频道设置</div>
          <div {...stylex.props(styles.cardDesc)}>
            频道页地址与公开信息——观众在 dailog.fm 通过频道页订阅你的节目。
          </div>
          <Show
            when={channel()?.channelActivatedAt}
            fallback={
              <div {...stylex.props(styles.error)}>
                频道尚未开通——请先完成「开通频道 + 录制声音」，再设置频道信息。
              </div>
            }
          >
            <TextField
              label="频道地址"
              value={slug()}
              onInput={onSlugInput}
              placeholder="频道地址"
              maxLength={30}
            />
            <div {...stylex.props(styles.slugStatus, slugCheck() === "ok" && styles.slugOk, slugCheck() === "taken" && styles.slugTaken)}>
              {slugCheck() === "checking"
                ? "检测中…"
                : slugCheck() === "ok"
                  ? "✓ 该地址可用"
                  : slugCheck() === "taken"
                    ? "✗ 该地址已被占用"
                    : slugCheck() === "invalid"
                      ? "仅限 3-30 位小写字母、数字、连字符"
                      : "频道页地址：" + (env.siteBaseUrl ? `${env.siteBaseUrl}/@${slug() || "..."}` : `/@${slug() || "..."}`)}
            </div>
            <TextField label="频道名" value={displayName()} onInput={setDisplayName} placeholder="频道名" maxLength={30} />
            <TextField label="频道简介" value={bio()} onInput={setBio} placeholder="频道简介（200 字以内）" maxLength={200} />
            <Button
              block
              onClick={saveChannel}
              disabled={channelBusy() || slugCheck() === "taken" || slugCheck() === "invalid"}
            >
              {channelBusy() ? "保存中…" : "保存频道设置"}
            </Button>
            <Show when={channelMsg()}>
              <div {...stylex.props(channelMsg()!.ok ? styles.statusOk : styles.error)} style={{ "margin-top": "12px" }}>
                {channelMsg()!.text}
              </div>
            </Show>
          </Show>
        </div>

        <div {...stylex.props(styles.card)}>
          <div {...stylex.props(styles.cardTitle)}>你的声音</div>
          <div {...stylex.props(styles.cardDesc)}>
            采样后立即生效。用于生成节目中"你"的声音——点击采样可试听，随时可以重新采样。
          </div>
          <VoiceSampler sampleId={sample()?.id ?? null} onSampleReady={submit} busy={busy()} />
          <Show when={error()}>
            <div {...stylex.props(styles.error)}>{error()}</div>
          </Show>
        </div>

        <div {...stylex.props(styles.card)}>
          <div {...stylex.props(styles.cardTitle)}>邀请码</div>
          <div {...stylex.props(styles.placeholder)}>
            发布满 3 期后，每发布一期获得一个邀请码（功能即将上线）
          </div>
        </div>

        <div {...stylex.props(styles.card)}>
          <div {...stylex.props(styles.cardTitle)}>订阅</div>
          <div {...stylex.props(styles.placeholder)}>
            免费用户可生成 1 期；Pro 订阅无限生成（支付功能即将上线）
          </div>
        </div>
      </div>
    </div>
  );
}
