// PWA 安装状态全局捕获（footer「安装 App」入口 + /install 引导页共用）。
// beforeinstallprompt 只在页面加载且满足可安装条件时触发一次——必须全站尽早捕获
// 并 preventDefault（否则浏览器直接弹安装条），用户后续从 footer 进入引导页时
// 仍可调用 prompt() 唤起原生安装 UI。
import { createSignal } from "solid-js";

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const [deferredPrompt, setDeferredPrompt] = createSignal<BeforeInstallPromptEvent | null>(null);
const [installed, setInstalled] = createSignal(false);

let initialized = false;

/** 全局初始化（AppShell 挂载时调用一次；客户端专用） */
export function initInstallStore() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const onPrompt = (event: Event) => {
    event.preventDefault();
    setDeferredPrompt(event as BeforeInstallPromptEvent);
  };
  const onInstalled = () => {
    setInstalled(true);
    setDeferredPrompt(null);
  };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
}

/** 是否已以独立窗口运行/已安装（display-mode standalone 或 iOS 私有属性） */
export const isInstalled = () => {
  if (installed()) return true;
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
};

/** 浏览器是否提供了可调用的一键安装（beforeinstallprompt 已触发） */
export const canInstall = () => deferredPrompt() !== null;

// iOS Safari 检测（含 iPadOS 桌面 UA 的触屏 Mac 分支）；排除微信等内嵌浏览器
export const isSafariIOS = () => {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  if (/micromessenger|weibo|baiduboxapp|mqqbrowser/i.test(ua)) return false;
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
};

/** 用户手势后调用：唤起浏览器原生安装 UI；返回是否安装成功 */
export async function requestInstall(): Promise<boolean> {
  const event = deferredPrompt();
  if (!event || typeof event.prompt !== "function") return false;
  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === "accepted") {
    setInstalled(true);
    setDeferredPrompt(null);
    return true;
  }
  return false;
}
