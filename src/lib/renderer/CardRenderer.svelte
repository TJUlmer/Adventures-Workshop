<script lang="ts">
  /**
   * The card frame. Establishes the bleed-sized coordinate system and picks the
   * face for the card's template.
   *
   * The frame is a container, so every child measurement in `cqw` is a fraction
   * of the card's width — the same markup is correct at a 120px thumbnail and
   * at 1632px print size.
   */
  import { MONO_LAYER } from '$lib/cards/mono';
  import type { CardTheme } from '$lib/cards/style';
  import { mergeCardStyle } from '$lib/cards/style';
  import { stockTheme } from '$lib/cards/theme';
  import type { Card } from '$lib/cards/types';
  import { characterLabel } from '$lib/characters/factory';
  import type { Character, HeroCharacterCard } from '$lib/characters/types';
  import { hasArtwork } from '$lib/core/artwork';
  import type { CustomSymbol } from '$lib/symbols/types';
  import ActionCardFace from './ActionCardFace.svelte';
  import CardArt from './CardArt.svelte';
  import CardbackFace from './CardbackFace.svelte';
  import EventCardFace from './EventCardFace.svelte';
  import { CARD_FORMATS, trimBox } from './geometry';
  import HeroCardbackFace from './HeroCardbackFace.svelte';
  import HeroCharacterCardFace from './HeroCharacterCardFace.svelte';
  import InitiativeCardFace from './InitiativeCardFace.svelte';
  import RulesCardFace from './RulesCardFace.svelte';
  import type { CardRenderOptions } from './types';
  import { DEFAULT_RENDER_OPTIONS } from './types';

  interface Props {
    card: Card | null;
    /** Owning character, used for the name ribbon. */
    character?: Character | null;
    /**
     * Render this character's deck back instead of a card. The frame, bleed and
     * export machinery are shared, so the back behaves like any other face.
     */
    cardback?: Character | null;
    /**
     * Render this hero's character card instead of a card. Same reasoning as
     * `cardback` — a stat-reference sheet is read off the character, not off
     * anything in `set.cards`, so it shares this frame the same way.
     */
    statCard?: Character | null;
    /**
     * Which of `statCard`'s identities to draw — its own fields when absent,
     * or one of `statCard.additionalCards` for a duo's second (or further)
     * sheet. Ignored unless `statCard` is set.
     */
    statCardEntry?: HeroCharacterCard | null;
    /** Fully resolved look. Falls back to the stock template. */
    theme?: CardTheme;
    /** Which face of a two-sided card to draw. Only event cards have both. */
    side?: 'front' | 'back';
    options?: Partial<CardRenderOptions>;
    /** The set's author-uploaded glyphs, for resolving `{{custom:…}}` tokens. */
    customSymbols?: CustomSymbol[];
  }

  let {
    card,
    character = null,
    cardback = null,
    statCard = null,
    statCardEntry = null,
    theme,
    side = 'front',
    options,
    customSymbols = []
  }: Props = $props();

  const settings = $derived({ ...DEFAULT_RENDER_OPTIONS, ...options });

  /*
   * Printer-friendly is one more layer on the cascade, applied last. It sits
   * above the card's own overrides rather than replacing them, so nothing in
   * the document changes and switching it off returns the design untouched.
   */
  const look = $derived.by(() => {
    const resolved = theme ?? stockTheme(card?.type, character?.role);
    return settings.printerFriendly ? mergeCardStyle(resolved, MONO_LAYER) : resolved;
  });

  /**
   * The finished image standing in for this face, or `null` to compose one.
   *
   * Per side, because an event card is designed on both and each can be
   * replaced on its own. A switched-on replacement with no image is treated as
   * off — the switch is only reachable once one is chosen, but a document can
   * be edited by hand and a blank card is a worse answer than the composed one.
   */
  const replacement = $derived.by(() => {
    if (!card) return null;
    /*
     * A replacement is a finished picture, and printer-friendly mode exists to
     * not print pictures. Composing the card instead is the only useful answer:
     * a card that prints as a blank rectangle is worse than one that prints in
     * a look its author did not choose, because only one of the two can be
     * played with.
     */
    if (settings.printerFriendly) return null;
    if (card.type === 'event' && side === 'back') {
      return card.useBackReplacement && hasArtwork(card.backReplacement)
        ? card.backReplacement
        : null;
    }
    return card.useReplacement && hasArtwork(card.replacement) ? card.replacement : null;
  });

  /** Each template has its own bleed size. */
  const format = $derived.by(() => {
    // A hero's back was supplied at the action card's own bleed canvas, not
    // the villain/minion back's trim-only size — see `HeroCardbackFace`.
    if (cardback) return cardback.role === 'hero' ? CARD_FORMATS.action : CARD_FORMATS.cardback;
    // The same 63×88mm sheet as an action card — see `CHARACTER_CARD`.
    if (statCard) return CARD_FORMATS.action;
    if (card?.type === 'initiative') return CARD_FORMATS.initiative;
    if (card?.type === 'rules' && card.landscape) return CARD_FORMATS.rulesLandscape;
    if (card?.type === 'rules') return CARD_FORMATS.rules;
    if (card?.type === 'event') return CARD_FORMATS.event;
    return CARD_FORMATS.action;
  });

  const frame = $derived(format.bleed);
  const trim = $derived(trimBox(format));

  /**
   * Hiding the bleed crops to the cut line by *oversizing and offsetting the
   * plate* inside a clipping frame — never by reshaping the plate.
   *
   * The plate always keeps the print file's aspect ratio and is always the
   * container that `cqw` resolves against, so every measurement in
   * `geometry.ts` means the same thing whether the bleed is shown or not.
   * Reshaping it was what pushed the boost disc off the divider and dropped
   * the bottom border out of frame.
   */
  const view = $derived.by(() => {
    if (settings.showBleed) {
      return { aspect: `${frame.width} / ${frame.height}`, width: '100%', left: '0%', top: '0%' };
    }
    return {
      aspect: `${trim.width} / ${trim.height}`,
      width: `${((frame.width / trim.width) * 100).toFixed(4)}%`,
      left: `${(-(trim.x / trim.width) * 100).toFixed(4)}%`,
      top: `${(-(trim.y / trim.height) * 100).toFixed(4)}%`
    };
  });


  const texture = $derived(TEXTURE_SPECS[look.texture.kind]);
  const textureUrl = $derived(texture?.image ?? null);
  const textureSize = $derived(texture?.size ?? '100% 100%');
  const textureBlend = $derived(texture?.blend ?? 'normal');
</script>

<script lang="ts" module>
  import type { TextureKind } from '$lib/cards/style';

  /**
   * Textures are generated rather than shipped: an SVG turbulence filter costs
   * nothing to store and resolves at any print size.
   *
   * `size` matters as much as the image. A weave or a grain is a *tile* and
   * must repeat at a fixed physical size; a vignette or a glow is a single
   * gradient across the whole card and must not repeat at all.
   */
  interface TextureSpec {
    image: string;
    /** `background-size`. Tiles use `cqw` so they scale with the card. */
    size: string;
    blend: string;
  }

  const noise = (frequency: number, opacity: number) =>
    `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='${frequency}' numOctaves='3'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='${opacity}'/%3E%3C/svg%3E")`;

  const TEXTURE_SPECS: Record<TextureKind, TextureSpec | null> = {
    none: null,
    grain: { image: noise(0.9, 1), size: '18cqw 18cqw', blend: 'overlay' },
    paper: { image: noise(0.42, 0.85), size: '30cqw 30cqw', blend: 'overlay' },
    speckle: { image: noise(1.6, 1), size: '9cqw 9cqw', blend: 'overlay' },
    linen: {
      image:
        'repeating-linear-gradient(0deg, rgb(0 0 0 / 0.55) 0 8%, transparent 8% 50%), repeating-linear-gradient(90deg, rgb(255 255 255 / 0.5) 0 8%, transparent 8% 50%)',
      size: '1.1cqw 1.1cqw',
      blend: 'overlay'
    },
    canvas: {
      image:
        'repeating-linear-gradient(0deg, rgb(0 0 0 / 0.5) 0 14%, transparent 14% 50%), repeating-linear-gradient(90deg, rgb(0 0 0 / 0.5) 0 14%, transparent 14% 50%)',
      size: '2.4cqw 2.4cqw',
      blend: 'overlay'
    },
    crosshatch: {
      image:
        'repeating-linear-gradient(45deg, rgb(0 0 0 / 0.6) 0 6%, transparent 6% 50%), repeating-linear-gradient(-45deg, rgb(0 0 0 / 0.6) 0 6%, transparent 6% 50%)',
      size: '1.8cqw 1.8cqw',
      blend: 'overlay'
    },
    halftone: {
      image: 'radial-gradient(rgb(0 0 0 / 0.75) 22%, transparent 24%)',
      size: '1.5cqw 1.5cqw',
      blend: 'overlay'
    },
    /* Single-pass finishes: one gradient stretched across the card. */
    vignette: {
      image: 'radial-gradient(ellipse 82% 82% at center, transparent 45%, rgb(0 0 0 / 0.85) 100%)',
      size: '100% 100%',
      blend: 'normal'
    },
    glow: {
      image:
        'radial-gradient(ellipse 90% 55% at 50% 0%, rgb(255 255 255 / 0.7), transparent 70%)',
      size: '100% 100%',
      blend: 'soft-light'
    }
  };
</script>

<div class="frame" class:printer-friendly={settings.printerFriendly} style:--card-aspect={view.aspect}>
  <!--
    The mode's class goes on the plate as well as the frame, and that is not
    belt and braces.

    `card-image.ts` rasterises by cloning **the plate** into a bare holder and
    freezing the computed styles there. Anything the card's look depends on that
    hangs off an ancestor of the plate is simply not matching by the time those
    styles are read — so a printer-friendly card photographed for an export came
    back with its artwork, in colour, because `display: none` had stopped
    applying to it. Hanging the class here too is what makes the mode survive
    being photographed.
  -->
  <div
    class="plate"
    class:printer-friendly={settings.printerFriendly}
    style:--plate-aspect="{frame.width} / {frame.height}"
    style:--trim-x="{((trim.x / frame.width) * 100).toFixed(4)}%"
    style:--trim-y="{((trim.y / frame.height) * 100).toFixed(4)}%"
    style:width={view.width}
    style:left={view.left}
    style:top={view.top}
  >
    {#if cardback}
      <article class="face" aria-label="Deck back">
        {#if cardback.role === 'hero'}
          <HeroCardbackFace character={cardback} />
        {:else}
          <CardbackFace character={cardback} />
        {/if}
      </article>
    {:else if statCard}
      <!--
        `hero-character` on the existing `.face` rather than a wrapper of its
        own: the printer-friendly rules below need something to scope to, and
        this face's class names are not all unique (`.fill`, `.border`,
        `.move` were all shared with another template). No new element, so no
        chance of disturbing a layout where every child is positioned.
      -->
      <article
        class="face hero-character"
        aria-label="{statCardEntry?.name.trim() || characterLabel(statCard)} character card"
      >
        <HeroCharacterCardFace character={statCard} card={statCardEntry} {customSymbols} />
      </article>
    {:else if card === null}
      <div class="blank">
        <span class="blank-label">No card selected</span>
      </div>
    {:else if replacement}
      <!--
        A finished image the author supplied, standing in for the whole face.
        It short-circuits here rather than inside each face so every template
        gets it from one place — and because the export photographs this same
        component, a replaced card exports replaced with nothing else to do.

        No texture over the top: the point of a replacement is that it is
        already finished, and a card-wide overlay would be the app editing it.
      -->
      <article class="face" aria-label="{card.name || 'Untitled card'} (replacement image)">
        <div class="replacement">
          <CardArt artwork={replacement} background="transparent" />
        </div>
      </article>
    {:else}
      <article class="face" aria-label={card.name || 'Untitled card'}>
        {#if card.type === 'action'}
          <ActionCardFace {card} {character} theme={look} {customSymbols} />
        {:else if card.type === 'initiative'}
          <InitiativeCardFace {card} theme={look} {customSymbols} />
        {:else if card.type === 'event'}
          <EventCardFace {card} theme={look} {side} {customSymbols} />
        {:else}
          <RulesCardFace {card} theme={look} {customSymbols} />
        {/if}

        {#if textureUrl}
          <div
            class="texture"
            style:background-image={textureUrl}
            style:background-size={textureSize}
            style:opacity={look.texture.opacity}
            style:mix-blend-mode={textureBlend}
          ></div>
        {/if}
      </article>
    {/if}

    {#if settings.showGuides}
      <div class="trim" aria-hidden="true"></div>
    {/if}
  </div>
</div>

<style>
  /* The clipping window. Its shape is the card the viewer is looking at. */
  .frame {
    position: relative;
    width: 100%;
    aspect-ratio: var(--card-aspect);
    overflow: hidden;
    border-radius: 2%;
    box-shadow: var(--shadow-card);
    isolation: isolate;
    background: var(--grey-1000);
  }

  /*
   * The print file. Always the bleed template's aspect ratio, and always the
   * container `cqw` resolves against, so card geometry is identical whether
   * the bleed is on screen or cropped away.
   */
  .plate {
    container-type: inline-size;
    position: absolute;
    aspect-ratio: var(--plate-aspect);
  }

  .face {
    position: absolute;
    inset: 0;
  }

  /* Bleed edge to bleed edge: a replacement is the whole print file. */
  .replacement {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  .blank {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: linear-gradient(180deg, var(--grey-900), var(--grey-1000));
    box-shadow: inset 0 0 0 1px var(--border-default);
    color: var(--text-muted);
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
  }

  .texture {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  /* -- printer-friendly ------------------------------------------------- */

  /*
   * What the style cascade could not carry.
   *
   * `MONO_LAYER` does the colour work, and it does most of it — the frame,
   * the panels, every ink, the pattern and the texture are all theme keys, and
   * the ribbon even keeps its outline for free because that outline is drawn
   * in `divider`. Four things are left over, and each is here for a reason the
   * theme could not answer:
   *
   *  - Artwork is not a colour.
   *  - Two of the faces paint from values held on the *card* rather than in
   *    the theme — an initiative band's fill and ink are the band's own — so
   *    there is no key to override.
   *  - The symbols are supplied as light artwork for a dark panel, so on white
   *    they would be invisible rather than merely pale.
   *  - With the frame gone white, the card window needs an edge drawn back on.
   *
   * `!important` throughout, and it is load-bearing rather than lazy: every
   * value being overridden is an inline style written by the face component,
   * which no selector can outrank. Printer-friendly is by definition the last
   * word on the card's colour, so saying so is honest.
   */
  .printer-friendly {
    /*
     * One hairline for every template. It resolves against the plate, so it is
     * 0.28mm on a 63mm card and 0.20mm on the 44mm initiative card — both
     * comfortably above the ~0.1mm where a consumer laser starts dropping a
     * line, and neither heavy enough to read as a border in its own right.
     */
    --keyline: 0.4cqw;

    background: #fff;
    box-shadow: none;
  }

  /* Artwork, wherever it appears: card art, a band's art, a deck back's. */
  .printer-friendly :global(.clip),
  .printer-friendly :global(.vignette) {
    display: none !important;
  }

  /* The card window's edge, now that the border around it is white on white. */
  .printer-friendly :global(.interior) {
    box-shadow: inset 0 0 0 var(--keyline) #000 !important;
  }

  /*
   * Line art drawn light for a dark card: the attack and defense symbols, the
   * split separator, and the deck back's frame. `brightness(0)` takes every
   * opaque pixel to black and leaves the alpha channel alone, which is what
   * keeps the shapes rather than filling their boxes.
   */
  .printer-friendly :global(.value-symbol),
  .printer-friendly :global(.split-symbol),
  .printer-friendly :global(.template) {
    filter: brightness(0) !important;
  }

  .printer-friendly :global(.separator-art) {
    background: #000 !important;
  }

  /*
   * A hero's combat ribbon. Its head is painted the *symbol's* own colour,
   * which identifies the symbol and so is not a theme key — on white it has to
   * be told to go white, or the one panel on the card that is not line art
   * would be a slab of it. The ribbon still reads, because its outline is
   * drawn in `divider` exactly as the villain's is.
   */
  .printer-friendly :global(.hero-head) {
    background: #fff !important;
  }

  .printer-friendly :global(.hero-symbol) {
    filter: brightness(0) !important;
  }

  /*
   * Event card. The reverse's outline is a real border, so it only needs its
   * colour back. The face is two full-bleed bands with nothing between them —
   * the heading panel reads as a panel because it is a different colour, which
   * on white it no longer is — so the second band takes the division as a rule.
   * `+ .band` is what confines this to the face: the reverse has one band.
   */
  .printer-friendly :global(.border) {
    border-color: #000 !important;
  }

  .printer-friendly :global(.band + .band) {
    border-top: var(--keyline) solid #000 !important;
  }

  /*
   * Initiative card. Its three bands carry their fill and their ink on the
   * card, one band at a time, so the theme has no key to reach them — this is
   * the one face where the cascade genuinely cannot do the work.
   */
  .printer-friendly :global(.band-bg) {
    background: #fff !important;
    box-shadow: inset 0 0 0 var(--keyline) #000 !important;
  }

  .printer-friendly :global(.label),
  .printer-friendly :global(.subject),
  .printer-friendly :global(.body),
  .printer-friendly :global(.move-value) {
    color: #000 !important;
  }

  /* The MOVE badge is a mask painted in its band's ink, so it inks like one. */
  .printer-friendly :global(.move) {
    background: #000 !important;
  }

  /*
   * The hero's character card, which needs the most of any face here — and
   * needs it for one structural reason: it is the only card that does not go
   * through the style cascade at all. `Character.characterCard` is its own
   * small design object (a border colour and three band fills, see
   * `HeroCharacterCardFace`), so `MONO_LAYER` has nothing to override and the
   * sheet printed in full colour. Everything below is that missing layer,
   * written as CSS because there is no theme to write it in.
   *
   * The split follows the card's own: what the frame art *draws* is line art
   * and inks black; what an author *fills* goes white and lets the line art
   * carry the shape.
   */

  /* The three band fills, and the health badge's shield — all fields. */
  .printer-friendly :global(.hero-character .fill),
  .printer-friendly :global(.hero-character .mask.badge) {
    background: #fff !important;
  }

  /*
   * The border mask is the outline and the bars between the bands: the card's
   * whole structure, and the only reason the white fields above read as
   * separate rows at all. Note this is a *mask over a fill*, so it takes
   * `background`, not the `border-color` the event card's real border above
   * takes — same class name, two different mechanisms.
   */
  .printer-friendly :global(.hero-character .mask.border),
  .printer-friendly :global(.hero-character .mask.badge-accent),
  .printer-friendly :global(.hero-character .mask.move-ink),
  .printer-friendly :global(.hero-character .mask.quote-marks) {
    background: #000 !important;
  }

  /*
   * …but the border is not only those bars. It is also a 144px band of colour
   * around the whole card — pale pink on the printed sheet, and 2.9mm of solid
   * black outside the trim if it is inked like the rest. Measured before this
   * clip: 25.4% of the trimmed face dark, against 3.7% for an action card.
   *
   * So it is clipped back to the printed rectangle plus one `--keyline`, which
   * turns the band into the card's outline and leaves every interior bar
   * untouched — the same "the frame goes white, the window gets an edge drawn
   * back on" trade every other template here makes, except that here the edge
   * is the border art's own inner boundary rather than a rule drawn beside it.
   *
   * The three `--card-*` values are set inline by `HeroCharacterCardFace`,
   * which is the only place that knows this card's measurements.
   */
  .printer-friendly :global(.hero-character .mask.border) {
    clip-path: inset(
      calc(var(--card-inset-y) - var(--keyline)) calc(var(--card-inset-x) - var(--keyline))
      round calc(var(--card-radius) + var(--keyline))
    ) !important;
  }

  /*
   * Copy. `.heading` and `.token-count` are white on the printed card, so they
   * are the two that would otherwise vanish rather than merely darken; the
   * rest carry an inline colour from the design object, which is why these
   * need `!important` like everything else here.
   */
  .printer-friendly :global(.hero-character .heading),
  .printer-friendly :global(.hero-character .token-count),
  .printer-friendly :global(.hero-character .health),
  .printer-friendly :global(.hero-character .move-figure),
  .printer-friendly :global(.hero-character .ability),
  .printer-friendly :global(.hero-character .quote-text),
  .printer-friendly :global(.hero-character .quote-attribution) {
    color: #000 !important;
  }

  /*
   * The attack lockup is one supplied picture, word and icon together, in the
   * colour that identifies the attack type — so like the value symbols above
   * it inks rather than recolours, keeping the shapes instead of filling
   * their boxes.
   */
  .printer-friendly :global(.hero-character .attack img) {
    filter: brightness(0) !important;
  }

  /* A swarm's tokens are drawn discs, not art: the ring is already black. */
  .printer-friendly :global(.hero-character .token) {
    background: #fff !important;
  }

  /* Cut line, for checking that nothing important sits in the bleed. */
  .trim {
    position: absolute;
    top: var(--trim-y);
    right: var(--trim-x);
    bottom: var(--trim-y);
    left: var(--trim-x);
    border: 1px dashed color-mix(in oklab, var(--info) 70%, transparent);
    border-radius: 1.2cqw;
    pointer-events: none;
  }
</style>
