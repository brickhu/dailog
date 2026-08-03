/** VITE_* 环境变量集中读取（缺 key 即时报错，避免运行期幽灵失败） */

function required(name: string, fallback?: string): string {
  const v = import.meta.env[name];
  if (typeof v === "string" && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`缺少环境变量 ${name}（apps/studio/.env.local）`);
}

export const env = {
  /** api 基地址；本地 dev 走 vite 代理时用同源相对路径 */
  apiBaseUrl: required("VITE_API_BASE_URL", ""),
  /** 浏览器扩展 id（chrome://extensions 加载后可见）；留空则隐藏扩展连接卡 */
  extensionId: required("VITE_EXTENSION_ID", ""),
};

export const isDev = import.meta.env.DEV;
