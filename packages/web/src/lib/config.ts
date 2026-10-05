/** Where the API server lives. All local: no domain, no account. */
export const API = process.env.RPWB_API ?? "http://127.0.0.1:3311";

/**
 * One gradient and one glyph per world.
 *
 * Covers are gradients, not images: this project downloads nothing
 * from outside, so a cover image would either be generated here or not
 * exist. Glyph and gradient derive from the name, so the same world always
 * has the same cover and two different worlds don't look alike.
 */
const PALETTES = ["g0", "g1", "g2", "g3", "g4", "g5"] as const;
const GLYPHS = ["◈", "✦", "⬢", "✧", "❖", "✹"] as const;

/** Stable sum: two different names must yield different colors. */
function hash(text: string): number {
  let value = 0;
  for (let i = 0; i < text.length; i++) {
    value = (value * 31 + text.charCodeAt(i)) % 1_000_003;
  }
  return value;
}

export function coverOf(seed: string): { palette: string; glyph: string } {
  const value = hash(seed);
  return {
    palette: PALETTES[value % PALETTES.length] ?? "g0",
    glyph: GLYPHS[Math.floor(value / 7) % GLYPHS.length] ?? "◈",
  };
}
