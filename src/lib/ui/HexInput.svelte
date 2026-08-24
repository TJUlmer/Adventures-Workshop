<script lang="ts">
  /**
   * A typable hex colour box.
   *
   * Every colour control in the app showed its value as hex and none of them
   * let anyone type one back, so matching a colour from outside the app meant
   * nudging a native picker until the readout agreed. This is that readout,
   * made editable, and it is one component rather than one per control
   * precisely because the fiddly part — knowing when *not* to commit — is the
   * same everywhere.
   *
   * Drawn as bare text on purpose: every caller already sits inside its own
   * bordered row, and a second border here reads as a field inside a field.
   * Size and colour come from `--hex-*` custom properties so a caller can
   * match its own row without this needing a variant prop per site.
   */
  import { normalizeHex } from './hex';

  interface Props {
    /** The colour in effect, as `#rrggbb`. Shown whenever nothing is being typed. */
    value: string;
    /** For screen readers — the field has no visible label of its own. */
    label: string;
    /** Called only with a parsed, normalised `#rrggbb`. */
    onchange: (hex: string) => void;
  }

  let { value, label, onchange }: Props = $props();

  /**
   * What the box shows while it is being typed in, or `null` when it is not.
   *
   * A draft is the whole reason this is a component. Committing per keystroke
   * would send the swatch to black the moment someone typed `#f`, because an
   * unparseable value is indistinguishable from black to
   * `<input type="color">`; refusing the keystroke instead would make the box
   * impossible to type in at all. So the value is held loose until the entry
   * is finished, and only then parsed.
   */
  let draft = $state<string | null>(null);

  /** Commit on blur and on Enter, never mid-keystroke. Unparseable reverts. */
  function commit(): void {
    const raw = draft;
    draft = null;
    if (raw === null) return;
    const parsed = normalizeHex(raw);
    if (parsed && parsed !== value) onchange(parsed);
  }
</script>

<input
  class="hex numeric"
  type="text"
  spellcheck="false"
  autocapitalize="off"
  autocomplete="off"
  value={draft ?? value}
  aria-label={label}
  oninput={(event) => (draft = event.currentTarget.value)}
  onblur={commit}
  onkeydown={(event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      /* Blurred deliberately, so the box visibly settles on the normalised
         value it just wrote — typing `fff` and seeing `#ffffff` come back is
         the confirmation that the entry landed. */
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      draft = null;
      event.currentTarget.blur();
    }
  }}
/>

<style>
  /*
   * `9ch`, not the `7ch` this started at — a hex value is exactly seven
   * characters, but `ch` is the advance of "0" and the uppercase letters here
   * are wider than that. At 11px the two came out within a pixel of each
   * other, so `#FFFFFF` overflowed by a hair and `text-overflow` spent two
   * more characters on an ellipsis to say so: the field read `#FFFF…` with
   * room to spare around it.
   *
   * Shrinkable rather than `flex: none`, which is the safety net that makes a
   * generous width safe: on a gradient row that genuinely runs out of space
   * the boxes give way and ellipsise, instead of the two of them pushing the
   * angle dial out through the side of the control.
   */
  .hex {
    width: var(--hex-width, 9ch);
    flex: var(--hex-flex, 0 1 auto);
    min-width: 0;
    background: none;
    border: none;
    padding: 0;
    font-size: var(--hex-size, var(--text-2xs));
    color: var(--hex-color, var(--text-muted));
    text-transform: uppercase;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hex:focus {
    outline: none;
    color: var(--hex-color-focus, var(--text-primary));
  }
</style>
