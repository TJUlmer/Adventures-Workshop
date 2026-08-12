<script lang="ts">
  /**
   * Per-band styling for an initiative card.
   *
   * Each of the three bands takes its own fill, ink and artwork, and the
   * artwork sits *over* the fill under a toggle — so any combination of image
   * and flat colour across the three bands is reachable.
   */
  import type { Fill } from '$lib/cards/style';
  import { solid } from '$lib/cards/style';
  import type { InitiativeBandKey, InitiativeCard } from '$lib/cards/types';
  import { initiativeBandLabel } from '$lib/cards/types';
  import { hasArtwork } from '$lib/core/artwork';
  import { INITIATIVE_BAND_DEFAULTS } from '$lib/renderer/geometry';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, ColorInput, FillEditor, Icon, Slider, Switch } from '$lib/ui';
  import EditorSection from './EditorSection.svelte';

  interface Props {
    card: InitiativeCard;
  }

  let { card }: Props = $props();

  const BANDS: readonly InitiativeBandKey[] = ['subject', 'rightNow', 'endOfRound'];

  /** One hidden input per band, so each picker targets its own band. */
  let inputs: Record<string, HTMLInputElement | null> = $state({});
  let error = $state<string | null>(null);

  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });
  }

  async function pick(
    band: InitiativeBandKey,
    event: Event & { currentTarget: HTMLInputElement }
  ): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    error = null;
    try {
      const source = await readAsDataUrl(file);
      workshop.editBand(card.id, band, (style) => {
        style.artwork.source = source;
        style.artwork.label = file.name;
        style.showArtwork = true;
      });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }

  function setFill(band: InitiativeBandKey, fill: Fill): void {
    workshop.editBand(card.id, band, (style) => {
      style.fill = fill;
    });
  }

  /** Case-insensitively, since a colour input writes lower-case hex. */
  const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  function isDefaultFill(fill: Fill, band: InitiativeBandKey): boolean {
    return fill.kind === 'solid' && sameColor(fill.color, INITIATIVE_BAND_DEFAULTS[band].fill);
  }

  function isDefaultInk(ink: string, band: InitiativeBandKey): boolean {
    return sameColor(ink, INITIATIVE_BAND_DEFAULTS[band].ink);
  }

  const pct = (value: number) => `${Math.round(value * 100)}%`;
</script>

{#each BANDS as band (band)}
  {@const style = card.bands[band]}
  {@const attached = hasArtwork(style.artwork)}

  <EditorSection title={initiativeBandLabel(card, band)}>
    {#snippet actions()}
      {#if attached}
        <Button
          size="sm"
          variant="ghost"
          onclick={() =>
            workshop.editBand(card.id, band, (target) => {
              target.artwork.source = null;
              target.artwork.label = '';
              target.showArtwork = false;
            })}
        >
          Remove art
        </Button>
      {/if}
    {/snippet}

    <input
      bind:this={inputs[band]}
      class="sr-only"
      type="file"
      accept="image/*"
      onchange={(event) => pick(band, event)}
    />

    <div class="row">
      <FillEditor
        label="Fill"
        value={style.fill}
        origin="template"
        overridden={!isDefaultFill(style.fill, band)}
        onchange={(fill) => setFill(band, fill)}
        onreset={() => setFill(band, solid(INITIATIVE_BAND_DEFAULTS[band].fill))}
      />

      <label class="ink">
        <span class="ink-label">Text</span>
        <!--
          A band's colours are stored outright rather than inherited, so what
          the reset returns to is the template's own value for *this* band —
          which is why Right Now goes back to dark ink and the others to white.
        -->
        <ColorInput
          value={isDefaultInk(style.ink, band) ? undefined : style.ink}
          inherited={INITIATIVE_BAND_DEFAULTS[band].ink}
          origin="template"
          onchange={(ink) =>
            workshop.editBand(
              card.id,
              band,
              (target) => (target.ink = ink ?? INITIATIVE_BAND_DEFAULTS[band].ink)
            )}
        />
      </label>
    </div>

    <div class="art">
      <button
        type="button"
        class="thumb"
        class:empty={!attached}
        title={attached ? 'Replace image' : 'Choose image'}
        onclick={() => inputs[band]?.click()}
      >
        {#if attached && style.artwork.source}
          <img src={style.artwork.source} alt="" />
        {:else}
          <Icon name="image" size={16} />
        {/if}
      </button>

      <div class="art-text">
        <span class="filename">{style.artwork.label || 'No image'}</span>
        <span class="sub">Drawn over the fill.</span>
      </div>

      <Button size="sm" onclick={() => inputs[band]?.click()}>
        <Icon name="upload" size={13} />
        {attached ? 'Replace' : 'Choose'}
      </Button>
    </div>

    {#if attached}
      <Switch
        label="Show artwork"
        hint="Off keeps the image but prints the fill alone."
        checked={style.showArtwork}
        onchange={(showArtwork) =>
          workshop.editBand(card.id, band, (target) => (target.showArtwork = showArtwork))}
      />

      {#if style.showArtwork}
        <div class="row">
          <Slider
            label="Scale"
            value={style.artwork.transform.scale}
            min={0.2}
            max={4}
            step={0.01}
            neutral={1}
            format={pct}
            onchange={(scale) =>
              workshop.editBand(card.id, band, (target) => (target.artwork.transform.scale = scale))}
          />
          <Slider
            label="Horizontal"
            value={style.artwork.transform.offsetX}
            min={-1}
            max={1}
            step={0.005}
            neutral={0}
            format={pct}
            onchange={(offsetX) =>
              workshop.editBand(
                card.id,
                band,
                (target) => (target.artwork.transform.offsetX = offsetX)
              )}
          />
          <Slider
            label="Vertical"
            value={style.artwork.transform.offsetY}
            min={-1}
            max={1}
            step={0.005}
            neutral={0}
            format={pct}
            onchange={(offsetY) =>
              workshop.editBand(
                card.id,
                band,
                (target) => (target.artwork.transform.offsetY = offsetY)
              )}
          />
          <Slider
            label="Brightness"
            value={style.artwork.adjustments.brightness}
            min={0.2}
            max={2}
            step={0.01}
            neutral={1}
            format={pct}
            onchange={(brightness) =>
              workshop.editBand(
                card.id,
                band,
                (target) => (target.artwork.adjustments.brightness = brightness)
              )}
          />
        </div>
      {/if}
    {/if}
  </EditorSection>
{/each}

{#if error}<p class="error">{error}</p>{/if}

<style>
  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: var(--space-3) var(--space-5);
  }

  .ink {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .ink-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .art {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
  }

  .thumb {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    color: var(--text-muted);
  }

  .thumb.empty {
    border-style: dashed;
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .art-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .filename {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .error {
    font-size: var(--text-xs);
    color: var(--danger);
  }
</style>
