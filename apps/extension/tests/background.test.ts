import { beforeEach, describe, expect, it, vi } from "vitest";
import { cacheCollect, getCollect, deleteCollect, listCollects, getAppBase, getRuntimeConfig, setRuntimeConfig, getRemoteRules, resetRulesCache, handleExternalMessage, isSupportedUrl } from "../src/background";
import { DEFAULT_RULES_URL } from "../src/env";
import type { CollectRules } from "../src/shared";

function mockChrome(overrides: Record<string, unknown> = {}) {
  const storage = {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const result: Record<string, unknown> = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          if (key in overrides) result[key] = overrides[key];
        }
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(overrides, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete overrides[key];
      }),
    },
  };
  const tabs = {
    create: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    get: vi.fn(async () => ({ url: undefined })),
    onActivated: { addListener: vi.fn() },
    onUpdated: { addListener: vi.fn() },
  };
  const action = { setIcon: vi.fn(async () => {}), setTitle: vi.fn(async () => {}) };
  (globalThis as Record<string, unknown>).chrome = { storage, tabs, action };
  return { storage, tabs, action };
}

function collectPayload() {
  return {
    platform: "claude" as const,
    conversationId: "c1",
    title: "t",
    url: "https://claude.ai/chat/c1",
    messages: [{ role: "user" as const, content: "hi" }],
  };
}

beforeEach(() => { vi.restoreAllMocks(); resetRulesCache(); });

describe("cacheCollect（本地缓存）", () => {
  it("返回 collectId + 确认入库页地址（运行时配置的 Studio 地址），并打开确认页", async () => {
    const { storage, tabs } = mockChrome({ dailogConfig: { appBase: "http://localhost:5173" } });
    const res = await cacheCollect(collectPayload());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.collectId).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.appUrl).toBe(`http://localhost:5173/import?collectId=${res.collectId}`);
    }
    expect(storage.local.set).toHaveBeenCalled();
    expect(tabs.create).toHaveBeenCalledWith({ url: `http://localhost:5173/import?collectId=${res.ok && res.collectId}` });
  });

  it("非法 dialogue → invalid_dialogue，不写缓存", async () => {
    const { storage } = mockChrome();
    const res = await cacheCollect({ ...collectPayload(), messages: [] });
    expect(res).toEqual({ ok: false, error: "invalid_dialogue" });
    expect(storage.local.set).not.toHaveBeenCalled();
  });

  it("缓存超上限裁剪最旧（保留 20 条）", async () => {
    const collected: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) {
      // 每条不同会话 URL（同 URL 会被新条目按重采集规则替换，测不到裁剪）
      collected[`id-${i}`] = { dialogue: { ...collectPayload(), conversationId: `c${i}`, url: `https://claude.ai/chat/c${i}` }, createdAt: i };
    }
    const { storage } = mockChrome({ dailogCollects: collected });
    await cacheCollect({ ...collectPayload(), conversationId: "z-new", url: "https://claude.ai/chat/z-new" });
    const saved = (storage.local.set as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).dailogCollects,
    )?.[0] as { dailogCollects: Record<string, { createdAt: number }> };
    const entries = Object.values(saved?.dailogCollects ?? {});
    expect(entries).toHaveLength(20);
    // 最旧（createdAt=0）被裁剪；保留的 createdAt 最小为 1
    expect(Math.min(...entries.map((e) => e.createdAt))).toBe(1);
    expect(Math.max(...entries.map((e) => e.createdAt))).toBeGreaterThan(10); // 新条目（Date.now()）在内
  });

  it("重采同会话：复用原 collectId 原地更新（身份稳定，条目数不变）", async () => {
    const { storage } = mockChrome({
      dailogCollects: {
        "old-id": { dialogue: { ...collectPayload(), url: "https://claude.ai/chat/c1?source=web" }, createdAt: 1, appBase: "https://app.dailog.fm" },
      },
    });
    const res = await cacheCollect({ ...collectPayload(), url: "https://claude.ai/chat/c1" });
    expect(res.ok).toBe(true);
    // 复用旧 ID，不生成新身份
    expect(res.ok && res.collectId).toBe("old-id");
    const saved = (storage.local.set as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).dailogCollects,
    )?.[0] as { dailogCollects: Record<string, { dialogue: { conversationId: string }; createdAt: number }> };
    // 仍只有一条，内容为最新采集
    const entries = Object.values(saved?.dailogCollects ?? {});
    expect(entries).toHaveLength(1);
    expect(entries[0].dialogue.conversationId).toBe("c1");
    expect(entries[0].createdAt).toBeGreaterThan(1); // createdAt 刷新
  });

  it("不同会话 URL 不互相替换", async () => {
    const { storage } = mockChrome({
      dailogCollects: {
        "old-id": { dialogue: { ...collectPayload(), url: "https://claude.ai/chat/other" }, createdAt: 1, appBase: "https://app.dailog.fm" },
      },
    });
    const res = await cacheCollect(collectPayload());
    expect(res.ok).toBe(true);
    expect(res.ok && res.collectId).not.toBe("old-id");
    const saved = (storage.local.set as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).dailogCollects,
    )?.[0] as { dailogCollects: Record<string, unknown> };
    expect(Object.keys(saved?.dailogCollects ?? {})).toHaveLength(2);
  });
});

describe("listCollects（待入库条目摘要）", () => {
  it("返回摘要并按 createdAt 倒序", async () => {
    mockChrome({
      dailogCollects: {
        "a": { dialogue: collectPayload(), createdAt: 1 },
        "b": {
          dialogue: {
            ...collectPayload(),
            conversationId: "c2",
            title: "t2",
            messages: [
              { role: "user", content: "x" },
              { role: "assistant", content: "y" },
            ],
          },
          createdAt: 2,
        },
      },
    });
    const res = await listCollects();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.items.map((i) => i.collectId)).toEqual(["b", "a"]);
      expect(res.items[0]).toMatchObject({ title: "t2", platform: "claude", messageCount: 2 });
      expect(res.items[1]).toMatchObject({ title: "t", messageCount: 1 });
    }
  });

  it("按 appBase 过滤：其它域的条目不可见（不传 = 当前生效基址）", async () => {
    mockChrome({
      dailogConfig: { appBase: "http://localhost:5173" },
      dailogCollects: {
        "dev": { dialogue: collectPayload(), createdAt: 1, appBase: "http://localhost:5173" },
        "prod": { dialogue: { ...collectPayload(), conversationId: "p" }, createdAt: 2, appBase: "https://app.dailog.fm" },
        "legacy": { dialogue: { ...collectPayload(), conversationId: "l" }, createdAt: 3 }, // 无 appBase 旧条目：全域可见
      },
    });
    const res = await listCollects();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.items.map((i) => i.collectId).sort()).toEqual(["dev", "legacy"]);
    }
    // 显式指定其它域
    const prod = await listCollects("https://app.dailog.fm");
    expect(prod.ok && prod.items.map((i) => i.collectId).sort()).toEqual(["legacy", "prod"]);
  });

  it("cacheCollect 记录条目所属 appBase", async () => {
    const { storage } = mockChrome({ dailogConfig: { appBase: "http://localhost:5173" } });
    await cacheCollect(collectPayload());
    const saved = (storage.local.set as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).dailogCollects,
    )?.[0] as { dailogCollects: Record<string, { appBase: string }> };
    expect(Object.values(saved?.dailogCollects ?? {})[0].appBase).toBe("http://localhost:5173");
  });

  it("空缓存 → 空列表", async () => {
    mockChrome();
    const res = await listCollects();
    expect(res).toEqual({ ok: true, items: [] });
  });
});

describe("getCollect / deleteCollect", () => {
  it("读取存在的缓存", async () => {
    mockChrome({ dailogCollects: { "abc": { dialogue: collectPayload(), createdAt: 1 } } });
    const res = await getCollect("abc");
    expect(res).toEqual({ ok: true, dialogue: collectPayload() });
  });

  it("不存在的 ID → collect_not_found", async () => {
    mockChrome();
    const res = await getCollect("nope");
    expect(res).toEqual({ ok: false, error: "collect_not_found" });
  });

  it("删除缓存条目", async () => {
    const { storage } = mockChrome({ dailogCollects: { abc: { dialogue: collectPayload(), createdAt: 1 } } });
    const res = await deleteCollect("abc");
    expect(res).toEqual({ ok: true });
    expect(storage.local.set).toHaveBeenCalledWith({ dailogCollects: {} });
  });
});

describe("运行时配置（options 页编辑，存 chrome.storage）", () => {
  it("setRuntimeConfig 写入配置对象；getRuntimeConfig 读回", async () => {
    const { storage } = mockChrome();
    await setRuntimeConfig({ appBase: "http://localhost:5173/" });
    expect(storage.local.set).toHaveBeenCalledWith({ dailogConfig: { appBase: "http://localhost:5173/" } });
    expect(await getRuntimeConfig()).toEqual({ appBase: "http://localhost:5173/" });
  });

  it("无配置 → 空对象", async () => {
    mockChrome();
    expect(await getRuntimeConfig()).toEqual({});
  });

  it("getAppBase：配置优先（trim 后使用）", async () => {
    mockChrome({ dailogConfig: { appBase: "  http://localhost:5173  " } });
    expect(await getAppBase()).toBe("http://localhost:5173");
  });

  it("getAppBase：无配置 → 构建默认", async () => {
    mockChrome();
    expect(await getAppBase()).toBe("https://app.dailog.fm");
  });
});

describe("getRemoteRules（远程抓取规则）", () => {
  it("拉取成功 → 返回规则；TTL 内重复调用走缓存（只请求一次）", async () => {
    const rules: CollectRules = {
      version: 1,
      platforms: { claude: { userSelector: "a", assistantSelector: "b" } },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(rules), { status: 200 }));
    (globalThis as Record<string, unknown>).fetch = fetchMock;
    const r1 = await getRemoteRules();
    expect(r1).toEqual({ ok: true, rules });
    const r2 = await getRemoteRules();
    expect(r2).toEqual({ ok: true, rules });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(DEFAULT_RULES_URL);
  });

  it("网络失败 → ok:false", async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn(async () => { throw new Error("network down"); });
    const r = await getRemoteRules();
    expect(r).toEqual({ ok: false, error: "network down" });
  });

  it("响应结构非法 → invalid_rules", async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn(async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 }));
    const r = await getRemoteRules();
    expect(r).toEqual({ ok: false, error: "invalid_rules" });
  });

  it("HTTP 错误 → 透传状态码", async () => {
    (globalThis as Record<string, unknown>).fetch = vi.fn(async () => new Response("", { status: 404 }));
    const r = await getRemoteRules();
    expect(r).toEqual({ ok: false, error: "http_404" });
  });
});

describe("handleExternalMessage（app 页面消息）", () => {
  it("MSG_CLOSE_TAB → 关闭发送方标签页", async () => {
    const { tabs } = mockChrome();
    const res = await handleExternalMessage({ type: "dailog:close-tab" }, { tab: { id: 7 } });
    expect(res).toEqual({ ok: true });
    expect(tabs.remove).toHaveBeenCalledWith(7);
  });

  it("MSG_CLOSE_TAB 无 sender tab → 不处理", async () => {
    const { tabs } = mockChrome();
    const res = await handleExternalMessage({ type: "dailog:close-tab" }, {});
    expect(res).toBeNull();
    expect(tabs.remove).not.toHaveBeenCalled();
  });

  it("MSG_GET_COLLECT → 读缓存", async () => {
    mockChrome({ dailogCollects: { abc: { dialogue: collectPayload(), createdAt: 1 } } });
    const res = await handleExternalMessage({ type: "dailog:get-collect", collectId: "abc" }, {});
    expect(res).toEqual({ ok: true, dialogue: collectPayload() });
  });

  it("未知消息 → null", async () => {
    mockChrome();
    expect(await handleExternalMessage({ type: "dailog:nope" }, {})).toBeNull();
  });
});

describe("isSupportedUrl（图标状态判定）", () => {
  it("支持域 → true", () => {
    expect(isSupportedUrl("https://claude.ai/chat/abc")).toBe(true);
    expect(isSupportedUrl("https://chat.deepseek.com/chat/1")).toBe(true);
    expect(isSupportedUrl("https://www.tongyi.com/")).toBe(true);
  });

  it("非支持域/非法 URL → false", () => {
    expect(isSupportedUrl("https://google.com")).toBe(false);
    expect(isSupportedUrl(undefined)).toBe(false);
    expect(isSupportedUrl("not a url")).toBe(false);
  });
});
