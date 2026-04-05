import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(serverDir, "..");

for (const name of [".env.local", ".env"] as const) {
  const full = path.join(projectRoot, name);
  if (fs.existsSync(full)) {
    // Later files win; override so a stale empty shell var cannot block .env values
    dotenv.config({ path: full, override: true });
  }
}

function parseBagsApiKeyFromDotEnvText(text: string): string | null {
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().replace(/\r$/, "");
    if (key !== "BAGS_API_KEY") continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1).trim();
    }
    val = val.replace(/\r$/, "");
    return val.length > 0 ? val : null;
  }
  return null;
}

/**
 * If dotenv skipped BAGS_API_KEY (CRLF/BOM/ordering), read it from .env once at boot.
 */
function hydrateBagsApiKeyFromFile(): void {
  const current = process.env.BAGS_API_KEY?.replace(/\r$/, "").trim() ?? "";
  if (current.length > 0) return;

  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) return;

  const parsed = parseBagsApiKeyFromDotEnvText(fs.readFileSync(envPath, "utf8"));
  if (parsed) process.env.BAGS_API_KEY = parsed;
}

hydrateBagsApiKeyFromFile();

/** Re-apply from disk before Bags calls (handles wrong cwd / stale process env). */
export function refreshBagsApiKeyFromEnvFile(): void {
  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) return;
  const parsed = parseBagsApiKeyFromDotEnvText(fs.readFileSync(envPath, "utf8"));
  if (parsed) process.env.BAGS_API_KEY = parsed;
}

export const ENV_PROJECT_ROOT = projectRoot;
