/* dailog PWA service worker
 * 策略：
 *  - 构建产物（/assets/*、/_build/assets/*，哈希文件名不可变）：缓存优先 + 后台更新
 *  - 壳静态资源（manifest/图标/favicon）：stale-while-revalidate（有缓存先回，后台刷新）
 *  - 导航请求（SSR HTML）：网络优先；离线回退到缓存的首页壳（离线可打开站点壳）
 *  - 其余（/v1/* API、外部资源）：仅网络，绝不缓存用户数据
 * 发版更新：改 VERSION 即可（旧缓存 activate 时自动清理）
 */
const VERSION = "v1";
const STATIC_CACHE = "dailog-static-" + VERSION;

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
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))))
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

  // 导航请求（页面 HTML）：网络优先，成功则更新首页壳缓存；离线回退到壳
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(STATIC_CACHE)
              .then((cache) => cache.put("/", copy))
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

  // 构建产物：缓存优先 + 后台更新（哈希文件不可变，可直接回缓存）
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/_build/assets/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches
                .open(STATIC_CACHE)
                .then((cache) => cache.put(request, copy))
                .catch(() => {});
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 壳静态资源：stale-while-revalidate
  if (
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.svg" ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches
                .open(STATIC_CACHE)
                .then((cache) => cache.put(request, copy))
                .catch(() => {});
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 其余请求：仅网络（不拦截）
});
