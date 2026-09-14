// claude 分享页服务端直采（宿主直跑版，2026-09-07 实测）
// 背景：claude.ai/share/<id> 为 SSR app 壳，消息由客户端拉 /api/chat_snapshots 渲染；
//       该 API 被 Cloudflare Turnstile 保护 —— curl / headless chrome 均被拦（403 / Just a moment）。
//       宿主完整 Chrome（有头、屏外窗口）+ socks 代理可被 Turnstile 放行 → 拿到完整 DOM → cheerio 提取。
// 依赖：本机 /Applications/Google Chrome.app（或 Chromium）；socks 代理（findSocksProxy，含 scutil 探测）。
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load as loadHtml } from "cheerio";

const MAX_WAIT_MS = 75e3; // Turnstile 自动放行 + React 渲染，正常 <15s
const POLL_MS = 4e3;


function findSocksProxy() {
  for (const name of ["ALL_PROXY", "HTTPS_PROXY", "https_proxy"]) {
    const v = process.env[name];
    if (v && /socks/i.test(v)) return v.replace(/^socks5h?:\/\//, "").replace(/\/$/, "");
  }
  if (process.platform === "darwin") {
    for (const sc of ["/usr/sbin/scutil", "/sbin/scutil"]) {
      try {
        const out = execFileSync(sc, ["--proxy"], { encoding: "utf-8" });
        if (!/SOCKSEnable\s*:\s*1/.test(out)) return null;
        const port = out.match(/SOCKSPort\s*:\s*(\d+)/)?.[1];
        const host = out.match(/SOCKSProxy\s*:\s*([^\s]+)/)?.[1] ?? "127.0.0.1";
        return port ? host + ":" + port : null;
      } catch {}
    }
  }
  return null;
}

function findHeadedChrome() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

// —— DOM → 消息（S2：新版 claude 分享页 user=[data-testid=user-message] assistant=[data-perf-reply-text]，文档序交错）——
function cleanText(t) {
  t = (t || "").replace(/\u00a0/g, " ");
  t = t.split(String.fromCharCode(10)).map((x) => x.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}
export function extractClaudeMessages(html) {
  const $ = loadHtml(html);
  const out = [];
  $('[data-testid="user-message"], [data-perf-reply-text]').each(function () {
    const isUser = $(this).attr("data-testid") === "user-message";
    let t;
    if (isUser) {
      t = cleanText($(this).text());
    } else {
      const $c = $(this).clone();
      $c.find('[data-not-prose], svg, button, .sr-only, script, style, [aria-hidden="true"], [data-cds="MessageActions"]').remove();
      $c.find("br").replaceWith("\n");
      $c.find("td, th").append(" | ");
      $c.find("tr").append("\n");
      $c.find("li").append("\n");
      $c.find("p, blockquote, pre, h1, h2, h3, h4, h5, h6").append("\n");
      t = cleanText($c.text());
    }
    if (t) out.push({ role: isUser ? "user" : "assistant", content: t });
  });
  return out;
}

// —— 有头 Chrome + CDP 渲染：导航 → 轮询等 transcript 出现 → 返回 outerHTML ——
function renderClaudeDom(url, proxy, chromePath) {
  return new Promise((resolve) => {
    const port = 9600 + Math.floor(Math.random() * 300);
    const profile = mkdtempSync(join(tmpdir(), "dlg-claude-"));
    const args = [
      "--no-sandbox", "--disable-gpu",
      "--user-data-dir=" + profile,
      "--remote-debugging-port=" + port,
      "--window-position=-32000,-32000", "--window-size=1280,900",
      "--no-first-run", "--no-default-browser-check",
      "about:blank"
    ];
    if (proxy) args.push("--proxy-server=socks5://" + proxy);
    const chrome = spawn(chromePath, args, { stdio: ["ignore", "ignore", "ignore"] });
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; try { chrome.kill("SIGKILL"); } catch {} resolve(val); } };
    setTimeout(() => done(null), MAX_WAIT_MS + 15e3);

    (async () => {
      try {
        // wait for devtools port
        let ready = false;
        for (let i = 0; i < 60 && !ready; i++) {
          try { const r = await fetch("http://127.0.0.1:" + port + "/json/version"); if (r.ok) ready = true; } catch {}
          if (!ready) await sleep(300);
        }
        if (!ready) return done(null);
        // open tab
        let tab;
        try {
          const r = await fetch("http://127.0.0.1:" + port + "/json/new?" + encodeURIComponent(url), { method: "PUT" });
          tab = await r.json();
        } catch { return done(null); }
        const cdp = await connectCdp(tab.webSocketDebuggerUrl);
        if (!cdp) return done(null);
        await cdp.send("Page.enable").catch(() => {});
        await cdp.send("Runtime.enable").catch(() => {});
        const exprInfo = [
          "(() => {",
          "  const u = document.querySelectorAll('[data-testid=\"user-message\"]').length;",
          "  const a = document.querySelectorAll('[data-perf-reply-text]').length;",
          "  const t = document.title || '';",
          "  return JSON.stringify({ u: u, a: a, t: t });",
          "})()"
        ].join(" ");
        const deadline = Date.now() + MAX_WAIT_MS;
        while (Date.now() < deadline) {
          await sleep(POLL_MS);
          try {
            const r = await cdp.send("Runtime.evaluate", { expression: exprInfo, returnByValue: true });
            let info = null;
            try { info = JSON.parse(r.result && r.result.value); } catch {}
            if (info && info.u >= 1 && info.a >= 1) {
              const dom = await cdp.send("Runtime.evaluate", {
                expression: "'<!DOCTYPE html>' + document.documentElement.outerHTML",
                returnByValue: true
              });
              return done(dom.result && dom.result.value);
            }
          } catch {}
        }
        done(null);
      } catch { done(null); }
    })();
  });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function connectCdp(wsUrl) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(wsUrl); } catch { return resolve(null); }
    let id = 0;
    const pending = new Map();
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(null); }, 20e3);
    ws.onopen = () => {
      clearTimeout(timer);
      const send = (method, params = {}) => new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
      resolve({ send, ws });
    };
    ws.onerror = () => { clearTimeout(timer); try { ws.close(); } catch {} resolve(null); };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
      }
    };
  });
}

// —— 入口：与 collectDialogue 同构返回 { ok, messages, title, source, sourceUrl } | { ok:false, error } ——
export async function collectClaudeShare(url, { title = null } = {}) {
  const chromePath = findHeadedChrome();
  if (!chromePath) {
    return { ok: false, error: "claude 直采需本机完整 Chrome（/Applications/Google Chrome.app）——当前未找到，可用 console-script 浏览器兜底" };
  }
  const proxy = findSocksProxy();
  if (!proxy) {
    return { ok: false, error: "claude 直采需 socks 代理（区域外访问）——当前未探测到，可用 console-script 浏览器兜底" };
  }
  console.log("[claude] 有头 Chrome 渲染: " + url + (proxy ? " (socks " + proxy + ")" : ""));
  const dom = await renderClaudeDom(url, proxy, chromePath);
  if (!dom) {
    return { ok: false, error: "claude 渲染失败（Turnstile/超时）——可用 console-script 浏览器兜底" };
  }
  const messages = extractClaudeMessages(dom);
  if (!messages || messages.length < 2 || !messages.some((m) => m.role === "user") || !messages.some((m) => m.role === "assistant")) {
    return { ok: false, error: "claude 渲染完成但未提取到完整消息（" + (messages ? messages.length : 0) + " 条）——可用 console-script 浏览器兜底" };
  }
  return { ok: true, messages, title: title || null, source: "render:claude", sourceUrl: url };
}
