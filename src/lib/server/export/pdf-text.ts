import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Text for PDFKit. The built-in Helvetica only has Western (WinAnsi)
 * characters, so Bengali runs (e.g. a category named "বাজার") are drawn with
 * an embedded Noto Sans Bengali (SIL Open Font License, assets/fonts), and
 * anything neither font can show becomes "?" instead of corrupting the text.
 */

export const BENGALI_FONT = "NotoSansBengali";

let bengaliFont: Buffer | null | undefined;

/** The font file, or null if it can't be read (Bengali then prints as "?"). */
export function loadBengaliFont(): Buffer | null {
  if (bengaliFont === undefined) {
    try {
      bengaliFont = readFileSync(path.join(process.cwd(), "assets/fonts/NotoSansBengali-Regular.woff"));
    } catch {
      bengaliFont = null;
    }
  }
  return bengaliFont;
}

const BENGALI = /[ঀ-৿‌‍]/;

/** Characters Helvetica can encode: printable ASCII, Latin-1 and the WinAnsi extras. */
const WIN_ANSI_EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
function isWinAnsi(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.has(char);
}

export interface TextRun {
  text: string;
  bengali: boolean;
}

/** Split text into Bengali and Western runs; unsupported characters become "?". */
export function textRuns(text: string, bengaliAvailable: boolean): TextRun[] {
  const runs: TextRun[] = [];
  for (const char of text.replace(/−/g, "-")) {
    const bengali = bengaliAvailable && BENGALI.test(char);
    const shown = bengali || isWinAnsi(char) ? char : "?";
    const last = runs[runs.length - 1];
    if (last && last.bengali === bengali) last.text += shown;
    else runs.push({ text: shown, bengali });
  }
  return runs;
}
