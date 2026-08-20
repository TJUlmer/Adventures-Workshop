<script lang="ts">
  /**
   * The card editor panel.
   *
   * Two tabs, not one long scroll: Content is what you edit on every card,
   * Design is what you touch once and then leave alone. Splitting them keeps
   * the common path short and stops the colour controls from burying the
   * ability text.
   *
   * The header is the card's identity and its two destructive-ish actions,
   * nothing else — the preview panel is where the eye should go.
   */
  import { cardLabel } from '$lib/cards/factory';
  import type { CardTheme } from '$lib/cards/style';
  import type { StyleOrigin } from '$lib/cards/theme';
  import {
    ACTION_SURFACES,
    EVENT_SURFACES,
    PROSE_SURFACES,
    STYLE_ORIGIN_LABELS
  } from '$lib/cards/theme';
  import {
    DISPLAY_FONT_NAMES,
    DISPLAY_FONTS,
    displayFontStack,
    displayFontWeight
  } from '$lib/renderer/fonts';
  import type { Card } from '$lib/cards/types';
  import { CARD_TYPE_META } from '$lib/cards/types';
  import { hasArtwork } from '$lib/core/artwork';
  import { ART_WINDOW, HERO_ART_WINDOW_HEIGHT } from '$lib/renderer/geometry';
  import { characterForCard, resolveStyleForCard, styleOriginForCard } from '$lib/sets/queries';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, Field, FillEditor, Icon, Section, Select, Tabs } from '$lib/ui';
  import ActionCardContent from './ActionCardContent.svelte';
  import ArtworkPanel from './ArtworkPanel.svelte';
  import InitiativeBandsPanel from './InitiativeBandsPanel.svelte';
  import InitiativeCardContent from './InitiativeCardContent.svelte';
  import ReplacementPanel from './ReplacementPanel.svelte';
  import RulesCardContent from './RulesCardContent.svelte';
  import StylePanel from './StylePanel.svelte';

  type Tab = 'content' | 'design';

  const SURFACES: Partial<Record<Card['type'], readonly (keyof CardTheme)[]>> = {
    action: ACTION_SURFACES,
    rules: PROSE_SURFACES,
    event: EVENT_SURFACES
  };

  const fontOptions = DISPLAY_FONT_NAMES.map((name) => ({
    value: name,
    label: DISPLAY_FONTS[name].label
  }));

  /** Read from the store rather than taken as a prop — see Workspace.svelte. */
  const card = $derived(workshop.selectedCard);

  /**
   * A hero's action card keeps its art window a different height than a
   * villain's or a minion's — the divider sits lower, at `HERO_DIVIDER_Y`
   * rather than `DIVIDER.y` (see `ActionCardFace`'s own `isHero` branch) — so
   * the Placement drag preview needs its own aspect ratio to match, rather
   * than `ArtworkPanel`'s default (`ART_WINDOW`'s own 1346×1061, correct only
   * for the shorter, non-hero window).
   */
  const isHeroCard = $derived(
    card?.type === 'action' && characterForCard(workshop.adventure, card)?.role === 'hero'
  );

  let tab = $state<Tab>('content');

  /**
   * Whether the composed design is reachable at all.
   *
   * An event card has two sides and only both being replaced hides the design
   * controls — replacing one still leaves the other to compose.
   */
  const replacedEntirely = $derived.by(() => {
    if (!card) return false;
    const front = card.useReplacement && hasArtwork(card.replacement);
    if (!front) return false;
    if (card.type !== 'event') return true;
    return card.useBackReplacement && hasArtwork(card.backReplacement);
  });

  const meta = $derived(card ? CARD_TYPE_META[card.type] : null);
  const resolvedTheme: CardTheme | null = $derived(
    card ? resolveStyleForCard(workshop.adventure, card) : null
  );

  /** Overrides on this card, shown as a badge so Design is never a mystery. */
  const overrideCount = $derived(card ? Object.keys(card.style).length : 0);

  const tabs = $derived([
    { value: 'content' as const, label: 'Content' },
    { value: 'design' as const, label: 'Design', badge: overrideCount }
  ]);

  function originFor(key: keyof CardTheme): string {
    if (!card) return '';
    const origin: StyleOrigin = styleOriginForCard(workshop.adventure, card, key);
    return STYLE_ORIGIN_LABELS[origin];
  }
</script>

{#if card && meta && resolvedTheme}
  <header class="head">
    <div class="identity">
      <span class="eyebrow" style:color="var({meta.colorVar})">{meta.label}</span>
      <h1 class="title">{cardLabel(card)}</h1>
    </div>

    <div class="actions">
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        aria-label="Duplicate card"
        title="Duplicate"
        onclick={() => workshop.duplicateCard(card.id)}
      >
        <Icon name="copy" size={14} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        aria-label="Delete card"
        title="Delete"
        onclick={() => workshop.removeCard(card.id)}
      >
        <Icon name="trash" size={14} />
      </Button>
    </div>
  </header>

  <div class="tabs">
    <Tabs bind:value={tab} {tabs} label="Card editor sections" />
  </div>

  <div class="body scroll-y">
    {#if tab === 'content'}
      {#if card.type === 'action'}
        <ActionCardContent {card} />
      {:else if card.type === 'initiative'}
        <InitiativeCardContent {card} />
      {:else}
        <RulesCardContent {card} />
      {/if}
    {:else}
      <!--
        Design reads in the order you work: the picture, then what colour the
        card is, then the finish laid over it. One block each, so a long run of
        controls does not read as one undifferentiated column.

        The replacement comes first because it is the question that decides
        whether any of the rest applies — and everything below it hides while it
        is on, for the same reason.
      -->
      <ReplacementPanel
        artwork={card.replacement}
        enabled={card.useReplacement}
        hint="A finished card, used instead of composing one."
        replaces="Replaces the whole face, template and all."
        landscape={card.type === 'event'}
        onpick={(source, label) =>
          workshop.editCard(card.id, (next) => {
            next.replacement.source = source;
            next.replacement.label = label;
            next.useReplacement = true;
          })}
        ontoggle={(useReplacement) =>
          workshop.editCard(card.id, (next) => (next.useReplacement = useReplacement))}
        onclear={() =>
          workshop.editCard(card.id, (next) => {
            next.replacement.source = null;
            next.replacement.label = '';
            next.useReplacement = false;
          })}
      />

      <!-- The reverse is a second designed side, so it gets its own. -->
      {#if card.type === 'event'}
        <ReplacementPanel
          artwork={card.backReplacement}
          enabled={card.useBackReplacement}
          title="Replacement image — reverse"
          hint="A finished back for this event card."
          replaces="Replaces the whole reverse, template and all."
          landscape
          onpick={(source, label) =>
            workshop.editCard(card.id, (next) => {
              if (next.type !== 'event') return;
              next.backReplacement.source = source;
              next.backReplacement.label = label;
              next.useBackReplacement = true;
            })}
          ontoggle={(use) =>
            workshop.editCard(card.id, (next) => {
              if (next.type === 'event') next.useBackReplacement = use;
            })}
          onclear={() =>
            workshop.editCard(card.id, (next) => {
              if (next.type !== 'event') return;
              next.backReplacement.source = null;
              next.backReplacement.label = '';
              next.useBackReplacement = false;
            })}
        />
      {/if}

      {#if replacedEntirely}
        <p class="replaced-note">
          This card prints as the image above. Turn the replacement off to get its
          composition back — nothing here has been discarded.
        </p>
      {:else if card.type === 'initiative'}
        <!--
          Initiative cards have no single art window; each band has its own,
          and the border is the only surface outside them — so it sits here
          rather than alone in a Colours block of one.
        -->
        <Section title="Artwork & text" description="Each band carries its own art and ink.">
          <FillEditor
            label="Frame & border"
            value={resolvedTheme.frame}
            origin={originFor('frame')}
            overridden={card.style.frame !== undefined}
            onchange={(fill) => workshop.setStyle({ entity: 'card', id: card.id }, 'frame', fill)}
            onreset={() =>
              workshop.setStyle({ entity: 'card', id: card.id }, 'frame', undefined)}
          />
          <InitiativeBandsPanel {card} />
        </Section>

        <!-- No pattern: the template has no panel for one to sit on. -->
        <Section title="Finish" description="Laid across the printed card.">
          <StylePanel
            target={{ entity: 'card', id: card.id }}
            resolved={resolvedTheme}
            {originFor}
            show={['texture']}
          />
        </Section>
      {:else}
        {#if card.type === 'action'}
          <Section title="Artwork" description="Shown in the card’s art window.">
            <ArtworkPanel
              target={{ entity: 'card', id: card.id }}
              styleTarget={{ entity: 'card', id: card.id }}
              resolved={resolvedTheme}
              bedOrigin={originFor('artBackground')}
              aspect={isHeroCard ? ART_WINDOW.width / HERO_ART_WINDOW_HEIGHT : undefined}
            />
          </Section>
        {:else if card.type === 'event'}
          <!--
            The event heading is the card's one piece of display type, and the
            printed original is a face we do not have — so which cut it takes
            is the author's call rather than a fixed choice.
          -->
          <Section
            title="Heading"
            description="The display face, on both the front and the reverse."
          >
            <Field label="Display font">
              <Select
                value={resolvedTheme.displayFont}
                options={fontOptions}
                onchange={(next) =>
                  workshop.setStyle({ entity: 'card', id: card.id }, 'displayFont', next)}
              />
            </Field>

            <div
              class="font-preview"
              style:font-family={displayFontStack(resolvedTheme.displayFont)}
              style:font-weight={displayFontWeight(resolvedTheme.displayFont)}
            >
              {card.heading.trim() || 'Adjective Event'}
            </div>
          </Section>
        {/if}

        <Section title="Colours" description="Surfaces and ink for this card only.">
          <StylePanel
            target={{ entity: 'card', id: card.id }}
            resolved={resolvedTheme}
            {originFor}
            show={['colour']}
            surfaces={SURFACES[card.type]}
          />
        </Section>

        <Section title="Pattern & texture" description="Overlays laid across the printed card.">
          <StylePanel
            target={{ entity: 'card', id: card.id }}
            resolved={resolvedTheme}
            {originFor}
            show={['pattern', 'texture']}
          />
        </Section>
      {/if}
    {/if}
  </div>
{/if}

<style>
  /* Says why the design controls are gone, where they would have been. */
  .replaced-note {
    margin: 0;
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background: var(--surface-inset);
    border: 1px solid var(--border-subtle);
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-7) var(--space-4);
  }

  .identity {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .eyebrow {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
  }

  .title {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    line-height: var(--leading-tight);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    gap: var(--space-1);
    flex: none;
  }

  .tabs {
    padding-inline: var(--space-7);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
    flex: 1 1 auto;
    min-height: 0;
    padding: var(--space-6) var(--space-7) var(--space-10);
  }

  /* The chosen face, set in the words that will actually be on the card. */
  .font-preview {
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    font-size: 30px;
    line-height: 1.1;
    text-transform: uppercase;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
</style>
