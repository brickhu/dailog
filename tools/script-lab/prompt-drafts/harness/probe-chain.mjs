import fs from "node:fs";
import { contractCoverage } from "./metrics.mjs";
let H = 0, T = 0;
for (const n of [2, 3, 4, 6, 10]) {
  const p = JSON.parse(fs.readFileSync("/tmp/e2e-" + n + "-r1.txt", "utf8").replace(/```json/, "").replace(/```/, "").trim()).proposals[0];
  const out = JSON.parse(fs.readFileSync("/tmp/fin" + n + ".json", "utf8"));
  const c = contractCoverage(p, out.lines); H += c.hit; T += c.total;
  console.log("e2e-" + n + " 探索链覆盖 " + c.hit + "/" + c.total + (c.missing.length ? "\n     漏：" + c.missing.slice(0, 4).join(" / ") : ""));
}
console.log("\n合计 " + H + "/" + T + " = " + Math.round(H / T * 100) + "%");