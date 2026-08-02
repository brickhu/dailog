import { describe, expect, it } from "vitest";
import postgres from "postgres";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("database connection", () => {
  it("can SELECT 1", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      const rows = await sql`select 1 as one`;
      expect(rows[0].one).toBe(1);
    } finally {
      await sql.end();
    }
  });
});
