import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Env } from "../config/env";
import * as schema from "./schema";

export function createDb(env: Env) {
  const client = postgres(env.DATABASE_URL, { max: 1 });
  return { db: drizzle(client, { schema }), client };
}
