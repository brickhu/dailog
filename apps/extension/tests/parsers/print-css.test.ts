import { afterEach, describe, expect, it } from "vitest";
import { applyPrintCss } from "../../src/content/print-css";

afterEach(() => { document.head.innerHTML = ""; });

describe("applyPrintCss（打印规则模拟）", () => {
  it("提取 @media print 块内规则并注入为普通规则", () => {
    document.head.innerHTML = `<style>
      .nav { display: block; }
      @media print {
        .chat-list { height: auto !important; max-height: none !important; }
        .nav { display: none; }
      }
      .other { color: red; }
    </style>`;
    const cleanup = applyPrintCss(document);
    const injected = document.querySelector("style[data-dailog-print]");
    expect(injected).not.toBeNull();
    const css = injected?.textContent ?? "";
    expect(css).toContain(".chat-list");
    expect(css).toContain("height: auto !important");
    expect(css).toContain("max-height: none !important");
    expect(css).toContain(".nav{display: none;}");
    // 非 print 规则不注入
    expect(css).not.toContain(".other");
    cleanup();
    expect(document.querySelector("style[data-dailog-print]")).toBeNull();
  });

  it("无 @media print 规则 → 不注入样式元素", () => {
    document.head.innerHTML = `<style>.a { color: red; }</style>`;
    const cleanup = applyPrintCss(document);
    expect(document.querySelector("style[data-dailog-print]")).toBeNull();
    cleanup();
  });
});
