import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Env } from "../config/env";
import * as schema from "./schema";

export function createDb(env: Env) {
  // max: 1 单连接池（MVP 串行）；idle_timeout 定期回收闲置连接——
  // DB 重启/断连后旧 socket 不会被感知，单连接池会永久卡死所有 DB 请求（2026-08 线上复现）
  const client = postgres(env.DATABASE_URL, { max: 1, idle_timeout: 30 });
  return { db: drizzle(client, { schema }), client };
}
