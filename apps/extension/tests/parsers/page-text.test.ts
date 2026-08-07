import { afterEach, describe, expect, it } from "vitest";
import { extractPageText } from "../../src/content/page-text";

afterEach(() => { document.body.innerHTML = ""; });

describe("extractPageText（整页文本兜底提取）", () => {
  it("剔除 script/style/svg/hidden 等非内容节点，保留正文", () => {
    document.body.innerHTML = `
      <script>var secret = "不应出现";</script>
      <style>.x { color: red }</style>
      <svg><text>图标文本</text></svg>
      <nav hidden>隐藏导航</nav>
      <div>对话内容第一行</div>
      <div>对话内容第二行</div>
    `;
    const text = extractPageText(document);
    expect(text).toContain("对话内容第一行");
    expect(text).toContain("对话内容第二行");
    expect(text).not.toContain("不应出现");
    expect(text).not.toContain("图标文本");
    expect(text).not.toContain("隐藏导航");
    expect(text).not.toContain(".x");
  });

  it("超长内容截断并标注", () => {
    document.body.innerHTML = `<div>${"长".repeat(150_000)}</div>`;
    const text = extractPageText(document);
    expect(text.length).toBeLessThanOrEqual(100_000 + 30);
    expect(text).toContain("已截断");
  });

  it("空页面 → 空串", () => {
    document.body.innerHTML = `<script>alert(1)</script>`;
    expect(extractPageText(document)).toBe("");
  });
});
