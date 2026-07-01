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
