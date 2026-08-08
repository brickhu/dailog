// PoC：Playwright 采 claude 分享页稳定性测试（持久化 profile 版）
// 首次运行若遇 Cloudflare 挑战：在弹出的窗口里手动完成一次验证，
// cf cookie 会存入 ./poc-profile，后续运行直接放行。
// 用法（在 dailogues 仓库根目录）：
//   NODE_PATH=/Users/free/Projects/storybook/storybook-test/node_modules node poc-share.cjs [分享链接] [次数]
const { chromium } = require("playwright");

const SHARE_URL = process.argv[2] ?? "https://claude.ai/share/6cc0f373-72c5-4afd-a223-98471688e736";
const TIMES = Math.max(1, Number(process.argv[3] ?? 1));
const PROFILE = process.env.DAILOG_PROFILE ?? "./poc-profile";
const PROXY = (process.env.ALL_PROXY ?? "socks5://127.0.0.1:1081").replace("socks5h://", "socks5://");

async function collectOnce(i, context) {
  const page = await context.newPage();
  let result = null;
  page.on("response", async (res) => {
    try {
      if (res.url().includes("chat_snapshots")) {
        const j = await res.json();
        result = {
          title: j?.name ?? "?",
          msgs: Array.isArray(j?.chat_messages) ? j.chat_messages.length : -1,
        };
      }
    } catch (e) {
      // 非 JSON 跳过
    }
  });
  const t0 = Date.now();
  await page.goto(SHARE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  const deadline = Date.now() + 90000; // 首次含手动验证窗口
  while (!result && Date.now() < deadline) await page.waitForTimeout(500);
  if (result) {
    console.log(`[${i}] ✅ ${result.msgs} 条消息 | "${result.title}" | ${Date.now() - t0}ms`);
    await page.close();
    return true;
  }
  const bodyText = await page.locator("body").innerText().catch(() => "");
  console.log(`[${i}] ❌ 未捕获（标题: "${await page.title()}" | body: ${bodyText.slice(0, 120).replace(/\n+/g, " ")}）`);
  await page.screenshot({ path: `poc-share-fail-${i}.png` }).catch(() => {});
  await page.close();
  return false;
}

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    channel: process.env.DAILOG_CHANNEL || "chrome",
    proxy: { server: PROXY },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  // 反自动化指纹
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh"] });
  });
  console.log(`首次若遇 "Just a moment..."：请在弹出窗口手动完成验证（一次即可，profile 会记住）\n`);
  const results = [];
  for (let i = 1; i <= TIMES; i++) results.push(await collectOnce(i, context));
  await context.close();
  const ok = results.filter(Boolean).length;
  console.log(`\n总计: ${ok}/${TIMES} 成功`);
  process.exit(ok === TIMES ? 0 : 1);
})();
