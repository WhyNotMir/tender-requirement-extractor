import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, basename, extname, resolve } from "node:path";
import { log } from "../logger";
import type { Manifest, FileEntry } from "../types/internal";

function fileIdFromName(name: string): string {
  return basename(name, extname(name))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function guessRole(name: string): FileEntry["roleGuess"] {
  const n = name.toLowerCase();
  if (/(^|[^a-z])lv([^a-z]|$)|leistungsverzeichnis|tender|ausschreibung/.test(n)) return "main_lv";
  if (/annex|anhang|anlage|plan|protokoll|datasheet/.test(n)) return "annex";
  if (/notice|bekanntmachung/.test(n)) return "notice";
  return "unknown";
}

export async function ingest(inputDir: string): Promise<Manifest> {
  const entries = await readdir(inputDir);
  const pdfs = entries.filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  log.info("ingest", `found ${pdfs.length} PDF(s)`, { dir: inputDir, pdfs });

  const files: FileEntry[] = [];
  for (const filename of pdfs) {
    const buf = await readFile(join(inputDir, filename));
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const entry: FileEntry = {
      fileId: fileIdFromName(filename),
      filename,
      pages: 0,
      sha256,
      roleGuess: guessRole(filename),
      language: "unknown",
    };
    files.push(entry);
    log.info("ingest", "registered file", {
      fileId: entry.fileId,
      sha256: sha256.slice(0, 12),
      roleGuess: entry.roleGuess,
    });
  }

  const tenderId =
    basename(resolve(inputDir)).toLowerCase().replace(/[^a-z0-9]+/g, "_") || "tender";
  return { tenderId, createdAt: new Date().toISOString(), files };
}
