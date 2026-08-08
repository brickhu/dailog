import { describe, expect, it, vi, beforeEach } from "vitest";
import { findOrgIdFromPage, fetchClaudeConversation } from "../../src/content/claude-api";

describe("findOrgIdFromPage（从资源时序提取组织 id）", () => {
  beforeEach(() => {
    vi.stubGlobal("performance", {
      getEntriesByType: () => [
        { name: "https://claude.ai/_next/static/chunks/app.js" },
        { name: "https://claude.ai/api/organizations/bbad9a2e-ed24-4dda-9322-6eab936392ce/chat_conversations_v2?limit=30" },
      ],
    });
  });

  it("匹配 /api/organizations/{uuid}/ 请求 → 返回 org id", () => {
    expect(findOrgIdFromPage()).toBe("bbad9a2e-ed24-4dda-9322-6eab936392ce");
  });

  it("无匹配 → null", () => {
    vi.stubGlobal("performance", { getEntriesByType: () => [{ name: "https://claude.ai/_next/static/app.js" }] });
    expect(findOrgIdFromPage()).toBeNull();
  });
});

describe("fetchClaudeConversation（详情接口 → dialogue）", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  const sample = {
    uuid: "conv-1",
    name: "新项目MRD商业和竞争评估",
    chat_messages: [
      {
        uuid: "m1",
        sender: "human",
        text: "这是我新项目的MRD，你阅读下内容",
        attachments: [{ file_name: "MRD.md", extracted_content: "# 市场需求文档\n正文内容" }],
      },
      { uuid: "m2", sender: "assistant", text: "好的，我读了你的 MRD，评估如下：…" },
      { uuid: "m3", sender: "human", text: "谢谢" },
      { uuid: "m4", sender: "assistant", text: "不客气" },
    ],
  };

  it("解析消息：sender→role，附件正文追加到消息文本", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => sample } as Response);
    const d = await fetchClaudeConversation("org-1", "conv-1");
    expect(d?.platform).toBe("claude");
    expect(d?.conversationId).toBe("conv-1");
    expect(d?.title).toBe("新项目MRD商业和竞争评估");
    expect(d?.messages.length).toBe(4);
    expect(d?.messages[0].role).toBe("user");
    expect(d?.messages[0].content).toContain("这是我新项目的MRD");
    expect(d?.messages[0].content).toContain("# 市场需求文档"); // 附件正文已并入
    expect(d?.messages[1].role).toBe("assistant");
  });

  it("HTTP 失败 / 非 JSON / 无有效消息 → null", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as unknown as Response);
    expect(await fetchClaudeConversation("org-1", "conv-1")).toBeNull();
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => { throw new Error("bad"); } } as unknown as Response);
    expect(await fetchClaudeConversation("org-1", "conv-1")).toBeNull();
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ chat_messages: [{ sender: "human", text: "x" }] }) } as unknown as Response);
    expect(await fetchClaudeConversation("org-1", "conv-1")).toBeNull(); // 缺 assistant
  });

  it("fetch 抛异常 → null", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network"));
    expect(await fetchClaudeConversation("org-1", "conv-1")).toBeNull();
  });
});
