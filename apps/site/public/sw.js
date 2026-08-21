/* dailog PWA service worker
 * 策略：
 *  - 构建产物（/assets/*、/_build/assets/*，哈希文件名不可变）：缓存优先 + 后台更新
 *  - 壳静态资源（manifest/图标/favicon）：stale-while-revalidate（有缓存先回，后台刷新）
 *  - 导航请求（SSR HTML）：网络优先；离线回退到缓存的首页壳（离线可打开站点壳）
 *  - 其余（/v1/* API、外部资源）：仅网络，绝不缓存用户数据
 * 发版更新：改 VERSION 即可（旧缓存 activate 时自动清理）
 *
 * 坏构建防护（2026-08）：dev 预览环境每次 push 自动重建部署，曾出现「编译成功但 CSS
 * 产物为空壳」的坏构建（SSR HTML 含 stylex 类名、CSS 只剩 reset ~1.2KB，页面无组件
 * 样式、hydration 后交互全失）。这类坏页一旦被 SW 缓存就会永久卡死（网络恢复/重新部署
 * 都救不回，只能清站点数据）。因此：
 *  - 首页壳（"/"）写入缓存前校验 HTML 完整性（须含 <!DOCTYPE html> 与 id="app" 挂载点），
 *    坏壳不写缓存；install 预缓存同样校验。
 *  - VERSION 升到 v2：activate 自动清理旧 dailog-static-v1 缓存，已中毒用户下次访问自愈。
 *
 * SPA fallback 顶替（2026-08）：CF Pages 对不存在的 /_build/assets/*.js 返回 200 + text/html
 * （SPA fallback 返回首页 HTML，而不是 404）。浏览器把 HTML 当 JS 解析 → MIME 错误 → 主 JS
 * chunk 加载失败 → hydration 不执行 → 图标/CSS/交互全失效（iOS 登录跳回首页复现）。且旧逻辑
 * response.ok 即缓存，会把这份 HTML 当 JS 缓存进 SW → 永久卡死。因此：
 *  - 构建产物/壳静态资源写缓存前校验 Content-Type：text/html 一律不缓存（SPA fallback 特征）
 *  - 命中缓存时也校验缓存条目类型，坏的 text/html 条目删除并回源
 *  - VERSION 升到 v3：activate 清理 v2 缓存（v2 可能已含被顶替的坏条目）
 */
const VERSION = "v4";
const STATIC_CACHE = "dailog-static-" + VERSION;

/** 壳完整性校验：残缺/坏构建的 HTML 不写入缓存（否则离线壳被污染成坏页） */
function isValidShell(text) {
  return text.includes("<!DOCTYPE html>") && text.includes('id="app"');
}

/** 响应是否可缓存的构建产物：非 HTML 才缓存（SPA fallback 会把缺失的 .js/.css 顶替成
 *  200 + text/html，这种响应绝不能进缓存——否则被当 JS/CSS 缓存，页面永久卡死） */
function isCacheableAsset(response) {
  if (!response.ok) return false;
  const type = (response.headers.get("content-type") || "").toLowerCase();
  // 只缓存真实资源：JS/CSS/JSON/图片/字体等；text/html 一律排除
  return !type.includes("text/html");
}

/** 缓存条目是否坏条目（SPA fallback 顶替的 HTML 被误缓存）：是则删除并返回 false */
async function dropBadCacheEntry(cache, request) {
  const cached = await cache.match(request);
  if (!cached) return false;
  if (isCacheableAsset(cached)) return false;
  // 命中坏条目（text/html 被缓存）：删除，让回源重新拿真实资源
  await cache.delete(request);
  return true;
}

const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  // addAll 任一 URL 失败会整体 reject（install 失败 → 无 SW）。改为逐 URL 容错：
  // 单条失败不影响安装，缺失资源由后续 fetch 兜底缓存。
  // "/" 额外校验壳完整性：坏构建（空壳 CSS）的首页不预缓存。
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_URLS.map(async (url) => {
            try {
              const response = await fetch(url);
              if (!response.ok) return;
              if (url === "/") {
                const text = await response.clone().text();
                if (!isValidShell(text)) return;
              }
              await cache.put(url, response);
            } catch {
              /* 单条失败忽略，继续其余 URL */
            }
          })
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("dailog-static-") && k !== STATIC_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 导航请求（页面 HTML）：网络优先，成功且校验为完整壳才更新首页壳缓存（坏壳不污染）；
  // 离线/失败回退到缓存的壳
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            // 后台校验 + 写缓存，不阻塞导航响应（probe 克隆与页面流读取互不影响）
            const probe = response.clone();
            caches
              .open(STATIC_CACHE)
              .then(async (cache) => {
                try {
                  const text = await probe.text();
                  if (isValidShell(text)) {
                    await cache.put("/", response.clone());
                  }
                } catch {
                  /* 校验失败不写缓存 */
                }
              })
              .catch(() => {});
          }
          return response;
        })
        .catch(() =>
          caches.match("/").then((cached) => cached || caches.match(request.url))
        )
    );
    return;
  }

  // 构建产物：缓存优先 + 后台更新（哈希文件不可变，可直接回缓存）。
  // 先剔除坏条目（SPA fallback 顶替的 text/html 被误缓存时）——否则命中即永久返回坏页；
  // 网络响应仅当非 HTML 时才写缓存。
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/_build/assets/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        await dropBadCacheEntry(cache, request);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then(async (response) => {
            if (isCacheableAsset(response)) {
              const copy = response.clone();
              cache.put(request, copy).catch(() => {});
              return response;
            }
            // SPA fallback 顶替的 text/html：浏览器 HTTP 缓存（immutable 1 年）可能已被污染，
            // 绕过缓存重试一次拿真实资源；仍坏则回缓存好条目或 404——绝不把 HTML 当 JS 返回
            const retry = await fetch(request, { cache: "reload" });
            if (isCacheableAsset(retry)) {
              const copy = retry.clone();
              cache.put(request, copy).catch(() => {});
              return retry;
            }
            return cached || new Response(null, { status: 404, statusText: "Not Found" });
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 壳静态资源：stale-while-revalidate（同样剔除/拒绝 SPA fallback 顶替的 text/html）
  if (
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.svg" ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        await dropBadCacheEntry(cache, request);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then(async (response) => {
            if (isCacheableAsset(response)) {
              const copy = response.clone();
              cache.put(request, copy).catch(() => {});
              return response;
            }
            // SPA fallback 顶替的 text/html：浏览器 HTTP 缓存（immutable 1 年）可能已被污染，
            // 绕过缓存重试一次拿真实资源；仍坏则回缓存好条目或 404——绝不把 HTML 当 JS 返回
            const retry = await fetch(request, { cache: "reload" });
            if (isCacheableAsset(retry)) {
              const copy = retry.clone();
              cache.put(request, copy).catch(() => {});
              return retry;
            }
            return cached || new Response(null, { status: 404, statusText: "Not Found" });
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 其余请求：仅网络（不拦截）
});
