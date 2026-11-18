import { register } from "node:module";

register("./workers-resolve-hook.mjs", { parentURL: import.meta.url });
