// Side-effect module: must be imported BEFORE pdfjs. pdfjs tries to polyfill
// DOMMatrix/Path2D for canvas rendering and warns when it can't. We only read
// the text layer (never render), so we predefine harmless stubs; pdfjs then
// sees them as present and skips the polyfill attempt entirely (no warning).
const g = globalThis as Record<string, unknown>;
if (typeof g.DOMMatrix === "undefined") g.DOMMatrix = class DOMMatrix {};
if (typeof g.Path2D === "undefined") g.Path2D = class Path2D {};

// Belt-and-suspenders: also drop the warning text if it still reaches console.
const originalWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (String(args[0] ?? "").includes("Cannot polyfill")) return;
  originalWarn(...args);
};
