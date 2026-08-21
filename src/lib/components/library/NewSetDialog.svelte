<script lang="ts">
  /**
   * "What are you making?" — asked once, when a set is created.
   *
   * This is the best moment to ask and the worst moment to assume. An author
   * who picks here never meets a workspace full of villain sections they have
   * no use for, and never has to discover that the choice existed; one who is
   * given a bare "New set" button finds out later, from Settings, by which
   * point switching may be refused because they have added a villain in the
   * meantime.
   *
   * A native `<dialog>`, not a hand-rolled overlay. It brings focus trapping,
   * Escape to close, the top layer and inert background with it — all of which
   * a div would have to reimplement, and all of which this app would otherwise
   * be adding a dependency for. `showModal()` is what turns those on, so the
   * element is opened through it rather than through an `open` attribute.
   */
  import { SET_KINDS, SET_KIND_META } from '$lib/sets/types';
  import type { SetKind } from '$lib/sets/types';
  import { Icon } from '$lib/ui';
  import type { IconName } from '$lib/ui/Icon.svelte';

  interface Props {
    open: boolean;
    onchoose: (kind: SetKind) => void;
    oncancel: () => void;
  }

  let { open, onchoose, oncancel }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);

  /* Driven from the prop rather than opened where the button is clicked, so
     the element and the flag cannot disagree about whether it is showing. */
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class="chooser"
  aria-labelledby="new-set-title"
  onclose={() => oncancel()}
>
  <div class="inner">
    <header class="head">
      <h2 class="title" id="new-set-title">What are you making?</h2>
      <p class="lede">
        This sets up your workspace. You can change it later in Settings, and nothing you make is
        ever deleted by changing it.
      </p>
    </header>

    <div class="kinds">
      {#each SET_KINDS as kind (kind)}
        {@const meta = SET_KIND_META[kind]}
        <button type="button" class="kind" onclick={() => onchoose(kind)}>
          <span class="kind-head">
            <Icon name={meta.icon as IconName} size={16} />
            <span class="kind-label">{meta.label}</span>
          </span>
          <span class="kind-summary">{meta.summary}</span>
          <span class="kind-detail">{meta.detail}</span>
        </button>
      {/each}
    </div>

    <footer class="foot">
      <button type="button" class="cancel" onclick={() => oncancel()}>Cancel</button>
    </footer>
  </div>
</dialog>

<style>
  /*
   * `dialog` ships with a border, padding and `max-width` of its own, and they
   * are not the app's. Reset here rather than fought with per-rule below.
   */
  .chooser {
    padding: 0;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg, 12px);
    background: var(--surface-raised);
    color: var(--text-default);
    max-width: min(640px, calc(100vw - var(--space-6) * 2));
  }

  .chooser::backdrop {
    background: rgb(0 0 0 / 0.55);
  }

  .inner {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-6);
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .lede {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed, 1.6);
    color: var(--text-muted);
  }

  /* Wrapping rather than shrinking — see the same note in `SetSettings`. */
  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .kind {
    flex: 1 1 240px;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-inset);
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      background var(--duration-fast) var(--ease-out);
  }

  .kind:hover,
  .kind:focus-visible {
    border-color: var(--accent);
    background: var(--surface-raised);
  }

  .kind-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .kind-label {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .kind-summary {
    font-size: var(--text-sm);
    color: var(--text-default);
  }

  .kind-detail {
    font-size: var(--text-xs);
    line-height: var(--leading-relaxed, 1.6);
    color: var(--text-muted);
  }

  .foot {
    display: flex;
    justify-content: flex-end;
  }

  .cancel {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .cancel:hover {
    border-color: var(--border-strong);
    color: var(--text-default);
  }
</style>
