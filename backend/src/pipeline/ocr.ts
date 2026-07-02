import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { log } from "../logger";

const exec = promisify(execFile);

// Rasterize one PDF page (pdftoppm) and OCR it (tesseract). Returns plain text,
// or null if the tools are not installed / the page fails — the caller then
// keeps the flagged text instead of crashing. Reading from the rendered image
// bypasses the broken font mapping, so ligatures come back correct.
export async function ocrPage(pdfPath: string, page: number, lang = "eng"): Promise<string | null> {
  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), "ocr-"));
    const prefix = join(dir, "page");
    await exec("pdftoppm", [
      "-png", "-r", "300", "-f", String(page), "-l", String(page), "-singlefile", pdfPath, prefix,
    ]);
    // --psm 6 (uniform text block) keeps list numbers attached to their item
    // text; the default auto mode splits the number column from the text column.
    const { stdout } = await exec("tesseract", [`${prefix}.png`, "stdout", "-l", lang, "--psm", "6"]);
    return stdout;
  } catch (error) {
    log.warn("ocr", "OCR unavailable or failed; keeping flagged text", {
      page,
      message: error instanceof Error ? error.message.slice(0, 120) : String(error),
    });
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
