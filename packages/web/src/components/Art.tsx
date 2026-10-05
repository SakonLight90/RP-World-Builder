/**
 * Cover art.
 *
 * The project downloads no images: here a world's cover is generated from a
 * composed gradient plus a glyph. Two honest consequences: covers look
 * different from each other and stay stable over time, and they don't look like photographs.
 *
 * Color depends on the name: two worlds with the same name share the same
 * cover, which is the right behavior — the cover identifies the world,
 * not the moment.
 */
import { useI18n } from "../i18n/provider";

/** Three colors and a glyph, derived from a stable sum over the name. */
const THEMES: { a: string; b: string; c: string; glyph: string }[] = [
  { a: "#6d4bff", b: "#c94f9e", c: "#241a5e", glyph: "✦" },
  { a: "#2f7ea8", b: "#59c9b0", c: "#0f2a4a", glyph: "◈" },
  { a: "#c9873a", b: "#e8c583", c: "#3a2210", glyph: "❖" },
  { a: "#a8415c", b: "#ef7da8", c: "#3a1020", glyph: "✧" },
  { a: "#3f8a63", b: "#7cc79a", c: "#10301f", glyph: "⬢" },
  { a: "#4d4a86", b: "#8785c4", c: "#18163a", glyph: "✹" },
  { a: "#7b4fc9", b: "#b06fd6", c: "#2a1240", glyph: "✵" },
  { a: "#c94f6d", b: "#f0a07a", c: "#3d1520", glyph: "❂" },
];

function pick(seed: string): (typeof THEMES)[number] {
  let value = 0;
  for (let i = 0; i < seed.length; i++) {
    value = (value * 33 + seed.charCodeAt(i)) % 1_000_003;
  }
  return THEMES[value % THEMES.length] ?? THEMES[0];
}

export interface ArtProps {
  /** The world name, or its id: decides the colors. */
  seed: string;
  /** Optional label above the glyph. */
  title?: string;
  /** Show the large glyph. */
  glyph?: boolean;
  /** Thickness of the bottom veil, for cards with text overlaid. */
  fade?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Art({ seed, title, glyph = true, fade = false, className, style }: ArtProps) {
  const theme = pick(seed);

  return (
    <div
      className={`art ${className ?? ""}`}
      style={
        {
          "--c1": theme.a,
          "--c2": theme.b,
          "--c3": theme.c,
          ...style,
        } as React.CSSProperties
      }
    >
      {glyph && (
        <span className="art-glyph" aria-hidden="true">
          {theme.glyph}
        </span>
      )}
      {title !== undefined && (
        <span className="rail-cap">
          <span style={{ fontFamily: "var(--font-gold)", fontSize: 17, fontWeight: 600 }}>
            {title}
          </span>
        </span>
      )}
      {fade && (
        <span className="art-bars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}

/** Cast tile. */
/**
 * Cast tile.
 *
 * `onRemove` is optional on purpose: without it, the tile stays a portrait and
 * doesn't take up space to joke about. With it, it also becomes the way to remove
 * a wrong character without redoing the campaign.
 *
 * The three words it shows come from the `play` catalog, the area that uses the
 * tile: `Art` itself renders no text of its own, and a component shared by
 * several pages can't own the copy for one of them.
 */
export function CastTile({
  name,
  label,
  onRemove,
}: {
  name: string;
  label?: string;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="cast">
      <Art seed={name} />
      <span>{label ?? name}</span>
      {onRemove ? (
        <button
          type="button"
          className="chip chip-bad"
          onClick={onRemove}
          aria-label={t("play.adapt.removeLabel", { name: label ?? name })}
          title={t("play.adapt.removeTitle")}
        >
          {t("play.adapt.remove")}
        </button>
      ) : null}
    </div>
  );
}
