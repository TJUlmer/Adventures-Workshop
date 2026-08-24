/**
 * Reading a hex colour a person typed.
 *
 * Every colour control in the app already showed its value as hex; none of
 * them let anyone type one back in, so matching a colour from somewhere else
 * meant nudging a native picker until the readout agreed. This is the parse
 * that makes those readouts editable.
 *
 * Deliberately forgiving about what it accepts and strict about what it
 * returns: `#RRGGBB`, lowercase, because that is the only form
 * `<input type="color">` will take as a value — hand it `#ABC` and it silently
 * falls back to black, which reads as the field having eaten the entry.
 */

/** `#rrggbb` (lowercase) for anything recognisable, or `null`. */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(raw)) return null;

  /* Three-digit shorthand is what a person writing by hand tends to reach for
     (`#fff`), and CSS accepts it, so refusing it would be pedantry. Four and
     eight digits carry alpha, which no `Fill` or ink in this app stores — a
     silently dropped alpha channel is worse than a rejected entry, so they
     are not accepted rather than truncated. */
  if (raw.length === 3) {
    const [r, g, b] = raw;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (raw.length === 6) return `#${raw}`;
  return null;
}
