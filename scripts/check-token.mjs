
import { loadConfig, setApiToken } from "../tools/dailog-cli/dist/lib.js";
import { readFileSync } from "node:fs";
const config = loadConfig(["--env", "local"]);
const session = JSON.parse(readFileSync(".dailog-editor/session.json", "utf8"));
if (session.token && session.apiBase === config.apiBase) { setApiToken(session.token); console.log("local token OK"); }
else console.log("local 无 token（session 是 " + session.apiBase + "）");
