
import { loadConfig, setApiToken, tryApi } from "../tools/dailog-cli/dist/lib.js";
import { readFileSync } from "node:fs";
for (const env of ["dev", "local"]) {
  const config = loadConfig(["--env", env]);
  const session = JSON.parse(readFileSync(".dailog-editor/session.json", "utf8"));
  if (session.token && session.apiBase === config.apiBase) setApiToken(session.token);
  else { console.log(env, "session 不匹配"); continue; }
  const list = await tryApi(config, "/v1/editor/submissions");
  const hit = Array.isArray(list) ? list.find((x) => x.id.startsWith("f5ce083b")) : null;
  console.log(env, "submitted:", Array.isArray(list) ? list.length : "?", "| f5ce083b:", hit ? "存在 collected=" + hit.collected : "不在");
}
