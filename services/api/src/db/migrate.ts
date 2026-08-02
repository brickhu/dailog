import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { z } from "zod";

// 迁移只需要数据库连接串，不依赖其他环境变量
const env = z.object({ DATABASE_URL: z.string().min(1) }).parse(process.env);

const sql = postgres(env.DATABASE_URL, { max: 1 });
await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
await sql.end();
console.log("migrations applied");
