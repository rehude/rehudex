import { chat } from "./llm.js";

const msg = await chat([{ role: "user", content: "用一句话介绍你自己" }]);
console.log(msg.content);
