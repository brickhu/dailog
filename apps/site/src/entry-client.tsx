import { mount, StartClient } from "@solidjs/start/client";

const root = document.getElementById("app");
if (!root) throw new Error("root #app not found");
mount(() => <StartClient />, root);
