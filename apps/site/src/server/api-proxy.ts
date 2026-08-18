// site 通用 api 转发（收藏/点赞/账号档案等）：透传 cookie（better-auth 会话）+ 显式 Origin + body
import { env } from "../lib/env";

export async function proxyApi(path: string, request: Request, method?: string): Promise<Response> {
  const cookie = request.headers.get("cookie");
  const contentType = request.headers.get("content-type");
  const headers: Record<string, string> = { Origin: env.siteBaseUrl };
  if (cookie) headers["Cookie"] = cookie;
  if (contentType) headers["Content-Type"] = contentType;
  const finalMethod = method ?? request.method;
  // 保留 query 字符串（?lang=zh&limit=20 等）：路径参数路由（:id）拼 path 时 query 在
  // request.url 上——不拼接则语言偏好/分页等参数在代理处丢失（recommended/playlists 均曾受影响）
  const query = new URL(request.url).search;
  const fullPath = query && !path.includes("?") ? path + query : path;
  // multipart（录音采样上传）必须按二进制转发——request.text() 会把二进制按 UTF-8 解码，
  // 无效字节被替换成 U+FFFD（efbfbd），R2 里存下损坏文件（TTS 参考音频解析失败）
  const isMultipart = (contentType ?? "").includes("multipart/form-data");
  const body = finalMethod === "GET"
    ? undefined
    : isMultipart
      ? await request.arrayBuffer()
      : await request.text().catch(() => "");
  const res = await fetch(`${env.apiBaseUrl}${fullPath}`, {
    method: finalMethod,
    headers,
    body,
  });
  // 响应侧同样防二进制损坏：音频（采样试听）必须 arrayBuffer 透传——res.text()
  // 会把无效 UTF-8 字节替换成 U+FFFD（与上传侧 multipart 同坑）
  const resContentType = res.headers.get("content-type") ?? "";
  const resBody = resContentType.includes("audio/")
    ? await res.arrayBuffer()
    : await res.text();
  return new Response(resBody, {
    status: res.status,
    headers: { "Content-Type": resContentType || "application/json" },
  });
}
