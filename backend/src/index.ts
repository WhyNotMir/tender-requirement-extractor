import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "../../env/.env");
config({ path: envPath });

const key = process.env.DEEPSEEK_API_KEY?.trim();
const keyStatus = key ? `set (${key.slice(0, 4)}…, ${key.length} chars)` : "NOT SET";

console.log(`[boot] env file: ${envPath}`);
console.log(`[boot] DEEPSEEK_API_KEY: ${keyStatus}`);
console.log(`[boot] DEEPSEEK_MODEL: ${process.env.DEEPSEEK_MODEL ?? "(default)"}`);
console.log("[boot] skeleton OK — ready for slice 1");
