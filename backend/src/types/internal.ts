// Internal artifacts passed between pipeline stages. Kept separate from the
// external deliverable contract (procurement.ts, added later).

export interface FileEntry {
  fileId: string; // stable short id derived from the filename
  filename: string;
  pages: number; // filled by the extract stage
  sha256: string;
  roleGuess: "main_lv" | "notice" | "annex" | "unknown";
  language: "de" | "en" | "unknown";
}

export interface Manifest {
  tenderId: string;
  createdAt: string;
  files: FileEntry[];
}

// One reconstructed text line with position, used for layout reasoning later.
export interface Line {
  page: number;
  y: number; // higher = nearer the top of the page
  x: number; // left x of the first token
  text: string;
}

export type PageKind =
  | "cover"
  | "toc"
  | "preamble"
  | "lv_positions"
  | "prose_spec"
  | "recap"
  | "form"
  | "annex"
  | "unknown";

export interface PageInfo {
  fileId: string;
  page: number;
  kind: PageKind; // filled by the classify stage; "unknown" until then
  textQuality: "clean" | "corrupted" | "image_only";
  charCount: number;
  method: "text" | "ocr" | "image_only";
}

export type ChunkKind =
  | "position" // an LV position block -> requirement candidate
  | "paragraph" // prose obligation
  | "checklist" // a required-document row
  | "preamble" // general condition from the preamble
  | "recap" // commercial summary -> validation only, never a leaf
  | "chrome" // header/footer noise
  | "void"; // "Entfällt" dummy -> filtered

export interface Chunk {
  id: string; // `${fileId}:p${page}:${ozCode|blockIdx}`
  fileId: string;
  page: number;
  kind: ChunkKind;
  ozCode: string | null; // LV position number when present
  title: string | null; // heading line of the block
  text: string; // full text of the block
  quantity: string | null; // e.g. "2 St", "1 psch"
  equivalence: boolean | null; // "oder gleichwertig" flag
}
