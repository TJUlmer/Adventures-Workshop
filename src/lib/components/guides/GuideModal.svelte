<script lang="ts">
  /**
   * The guide overlay: one step at a time, Back and Next, X to leave.
   *
   * Mounted once, in `App.svelte`, above every view — see
   * `state/guides.svelte.ts` for why a guide is an overlay rather than a
   * place. Nothing else needs to know it exists; anything anywhere calls
   * `guides.open(id)`.
   *
   * A native `<dialog>` opened with `showModal()`, for the reasons
   * `NewSetDialog` already sets out: focus trapping, Escape, the top layer
   * and an inert background all arrive with it, and every one of them is
   * something a div would have to reimplement in an app that has no
   * dependency to reimplement them from. Driven from the store rather than
   * opened where the button is clicked, so the element and the state cannot
   * disagree about whether it is showing.
   */
  import type { GuideActionKind } from '$lib/guides/types';
  import { guides } from '$lib/state/guides.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Icon } from '$lib/ui';
  import GuideShot from './GuideShot.svelte';

  let dialog = $state<HTMLDialogElement | null>(null);

  const guide = $derived(guides.guide);
  const step = $derived(guides.step);

  /*
   * `guides.opened` is read for its side effect on this effect's
   * dependencies, not for its value — see the store. It is what makes
   * re-opening the guide that is already open still call `showModal()`,
   * which matters because the element can be closed without the store
   * hearing about it and there is no reactive way to observe `dialog.open`.
   */
  $effect(() => {
    void guides.opened;
    if (!dialog) return;
    if (guide && !dialog.open) dialog.showModal();
    if (!guide && dialog.open) dialog.close();
  });

  /**
   * Whether a step's action can actually be carried out from here.
   *
   * A `setPage` action needs a set to be open, and a guide read from Home has
   * none — so the button is hidden rather than offered and found to go
   * somewhere unexpected. `navigation.inSet`, not "is there an `adventure`":
   * there always is one (`App.svelte` leans on that), so the honest question
   * is whether the reader is *in* a set, not whether a document is loaded.
   * `guides/types.ts` says this is why actions are a closed union — only a
   * fixed set of destinations can be checked like this.
   */
  function reachable(action: GuideActionKind): boolean {
    return action.to === 'setPage' ? navigation.inSet : true;
  }

  function run(action: GuideActionKind): void {
    guides.close();
    if (action.to === 'gallery') navigation.openGallery();
    else if (action.to === 'home') void workshop.closeSet();
    else navigation.go(action.page);
  }

  /**
   * Left and right arrows page through, which is what a reader tries first in
   * anything with Back and Next. Escape is the dialog's own and needs
   * nothing; it fires `close`, which is where the store is cleared.
   */
  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight' && !guides.isLast) {
      event.preventDefault();
      guides.next();
    }
    if (event.key === 'ArrowLeft' && !guides.isFirst) {
      event.preventDefault();
      guides.back();
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="guide"
  aria-labelledby="guide-title"
  onclose={() => guides.close()}
  {onkeydown}
>
  {#if guide && step}
    <div class="inner">
      <header class="head">
        <span class="mark"><Icon name={guide.icon} size={15} /></span>
        <h2 class="title" id="guide-title">{guide.title}</h2>
        <button type="button" class="close" aria-label="Close guide" onclick={() => guides.close()}>
          <Icon name="plus" size={16} />
        </button>
      </header>

      <!--
        Keyed on the step index so the body is torn down and rebuilt between
        steps. Without it, `GuideShot` would be reused across a step that has
        a screenshot and one that does not, and the image element would keep
        the previous shot's loaded dimensions.
      -->
      {#key guides.index}
        <div class="body">
          <p class="text">{step.text}</p>
          {#if step.shot}
            <GuideShot shot={step.shot} alt={step.alt ?? ''} hotspots={step.hotspots} />
          {/if}
        </div>
      {/key}

      <footer class="foot">
        <button
          type="button"
          class="nav"
          onclick={() => guides.back()}
          disabled={guides.isFirst}
        >
          Back
        </button>

        <div class="progress">
          <span class="count">Step {guides.index + 1} of {guides.total}</span>
          <span class="dots">
            {#each guide.steps as _, index (index)}
              <button
                type="button"
                class="dot"
                class:here={index === guides.index}
                aria-label="Go to step {index + 1}"
                aria-current={index === guides.index ? 'step' : undefined}
                onclick={() => guides.goto(index)}
              ></button>
            {/each}
          </span>
        </div>

        <div class="end">
          {#if guides.isLast}
            {#if guide.action && reachable(guide.action.run)}
              <button type="button" class="nav" onclick={() => run(guide.action!.run)}>
                {guide.action.label}
              </button>
            {/if}
            <button type="button" class="nav primary" onclick={() => guides.close()}>Got it</button>
          {:else}
            <button type="button" class="nav primary" onclick={() => guides.next()}>Next</button>
          {/if}
        </div>
      </footer>
    </div>
  {/if}
</dialog>

<style>
  /* `dialog`'s own border, padding and max-width are not this app's. */
  .guide {
    padding: 0;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    color: var(--text-default);
    width: min(760px, calc(100vw - var(--space-6) * 2));
    max-width: none;
    max-height: calc(100vh - var(--space-6) * 2);
  }

  .guide::backdrop {
    background: rgb(0 0 0 / 0.55);
  }

  .inner {
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - var(--space-6) * 2);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-5) var(--space-6);
    border-bottom: 1px solid var(--border-subtle);
  }

  .mark {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .title {
    flex: 1 1 auto;
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  /* The X. A rotated plus rather than a glyph of its own — the icon set has
     no cross, and a `+` at 45° is exactly one. */
  .close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: var(--radius-sm);
    rotate: 45deg;
    color: var(--text-muted);
  }

  .close:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  /* The one scrolling region: the chrome above and below stays put, so Next
     is always where it was on the step before. */
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6);
    overflow-y: auto;
  }

  .text {
    margin: 0;
    max-width: 62ch;
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed, 1.6);
    color: var(--text-secondary);
  }

  .foot {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--border-subtle);
  }

  /*
   * The progress readout takes all the slack and centres itself in it, with
   * both ends sized to their own contents. That is what keeps the dots
   * centred in the *dialog* whatever the buttons say — "Got it" beside
   * "Browse the gallery" is a good deal wider than "Next" alone, so a centre
   * that depended on the buttons would drift from step to step.
   */
  .progress {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }

  .count {
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .dots {
    display: flex;
    gap: var(--space-2);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--border-default);
    transition: background var(--duration-fast) var(--ease-out);
  }

  .dot:hover {
    background: var(--text-muted);
  }

  .dot.here {
    background: var(--accent);
  }

  .end {
    flex: 0 0 auto;
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
  }

  .nav {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }

  .nav:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .nav:disabled {
    opacity: 0.4;
  }

  .nav.primary {
    border-color: transparent;
    background: var(--accent);
    color: var(--text-on-accent);
  }

  .nav.primary:hover {
    background: var(--accent-hover, var(--accent));
    color: var(--text-on-accent);
  }

</style>
