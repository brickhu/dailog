
import { loadConfig, setApiToken } from "../tools/dailog-cli/dist/lib.js";
import { readFileSync } from "node:fs";
const config = loadConfig(["--env", "dev"]);
const session = JSON.parse(readFileSync(".dailog-editor/session.json", "utf8"));
if (session.token && session.apiBase === config.apiBase) setApiToken(session.token);
const m = await import("../tools/dailog-cli/dist/fetch.js");
try {
  const r = await m.extractSubmission(config, "f5ce083b-22f3-5c31-96ab-c4bd81b7c7cf", session.token);
  console.log("result:", JSON.stringify(r).slice(0, 200));
} catch (e) {
  console.log("THROWN:", e.message);
}
