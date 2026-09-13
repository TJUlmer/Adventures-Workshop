<script lang="ts">
  /**
   * A deliberately high-friction replacement for an out-of-date fork.
   *
   * Updating is useful, but it is also the one lineage action that discards
   * the author's edits. A modal plus an explicit acknowledgement keeps the
   * Home-page revision notice informative without turning it into a one-click
   * destructive action.
   */
  import { fetchSetBySlug, hydratePublishedSet } from '$lib/cloud/sets';
  import { sourceOf, updateFork } from '$lib/sets/fork';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, Icon } from '$lib/ui';

  interface Props {
    open: boolean;
    latestRevision: number;
    oncancel: () => void;
  }

  let { open, latestRevision, oncancel }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let acknowledged = $state(false);
  let stage = $state<'idle' | 'fetching' | 'hydrating' | 'saving'>('idle');
  let progressDone = $state(0);
  let progressTotal = $state(0);
  let error = $state<string | null>(null);
  let controller: AbortController | null = null;

  const busy = $derived(stage !== 'idle');
  const set = $derived(workshop.adventure);
  const currentRevision = $derived(set.origin?.revision ?? 0);
  const progressLabel = $derived.by(() => {
    if (stage === 'fetching') return 'Finding the latest published revision…';
    if (stage === 'hydrating') {
      return progressTotal > 0
        ? `Downloading artwork ${progressDone} of ${progressTotal}…`
        : 'Downloading artwork…';
    }
    if (stage === 'saving') return 'Saving the updated copy…';
    return '';
  });

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      acknowledged = false;
      error = null;
      stage = 'idle';
      progressDone = 0;
      progressTotal = 0;
      dialog.showModal();
    }
    if (!open && dialog.open && !busy) dialog.close();
  });

  $effect(() => () => controller?.abort());

  function close(): void {
    if (!busy) dialog?.close();
  }

  async function replaceCopy(): Promise<void> {
    if (busy || !acknowledged) return;

    const current = structuredClone($state.snapshot(workshop.adventure));
    const origin = current.origin;
    if (!origin) return;

    error = null;
    progressDone = 0;
    progressTotal = 0;
    stage = 'fetching';
    controller = new AbortController();

    try {
      const published = await fetchSetBySlug(origin.slug, controller.signal);
      if (!published) throw new Error('The original set is no longer available.');
      if (published.revision <= origin.revision) {
        throw new Error('This copy is already based on the latest published revision.');
      }

      stage = 'hydrating';
      const hydrated = await hydratePublishedSet(
        published,
        (done, total) => {
          progressDone = done;
          progressTotal = total;
        },
        controller.signal
      );

      const stillOpen = workshop.adventure;
      if (
        stillOpen.id !== current.id ||
        stillOpen.origin?.slug !== origin.slug ||
        stillOpen.origin.revision !== origin.revision
      ) {
        throw new Error('The open set changed before the update could be saved.');
      }

      stage = 'saving';
      const replacement = updateFork(
        hydrated,
        current.id,
        sourceOf(published, origin.authorName)
      );
      if (!(await workshop.replaceOpenSet(replacement))) {
        throw new Error(
          workshop.libraryActionError ?? 'The updated copy could not be saved.'
        );
      }

      stage = 'idle';
      dialog?.close();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      error = cause instanceof Error ? cause.message : 'The copy could not be updated.';
    } finally {
      controller = null;
      stage = 'idle';
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="update-dialog"
  aria-labelledby="fork-update-title"
  oncancel={(event) => {
    if (busy) event.preventDefault();
  }}
  onclose={() => oncancel()}
>
  <div class="inner">
    <header class="head">
      <span class="warning-icon"><Icon name="rotate" size={18} /></span>
      <div>
        <h2 id="fork-update-title">Replace this copy with revision {latestRevision}?</h2>
        <p>It is currently based on revision {currentRevision}.</p>
      </div>
    </header>

    <div class="warning">
      <strong>This is a complete replacement, not a merge.</strong>
      <p>
        Every card, image, component, and setting in this copy will be replaced by the latest
        published version. Changes you made here cannot be recovered unless you first download a
        project backup from Export.
      </p>
    </div>

    <label class="acknowledgement" class:disabled={busy}>
      <input type="checkbox" bind:checked={acknowledged} disabled={busy} />
      <span>I understand that my changes to this copy will be overwritten.</span>
    </label>

    {#if progressLabel}
      <p class="progress" aria-live="polite"><span class="spinner"></span>{progressLabel}</p>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <footer class="actions">
      <Button variant="secondary" onclick={close} disabled={busy}>Cancel</Button>
      <Button variant="danger" onclick={() => void replaceCopy()} disabled={!acknowledged || busy}>
        Replace my copy
      </Button>
    </footer>
  </div>
</dialog>

<style>
  .update-dialog {
    width: min(520px, calc(100vw - var(--space-6) * 2));
    max-width: none;
    padding: 0;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    color: var(--text-primary);
  }

  .update-dialog::backdrop {
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
    align-items: flex-start;
    gap: var(--space-3);
  }

  .head h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  .head p {
    margin-top: var(--space-1);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .warning-icon {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    flex: none;
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--warning) 15%, transparent);
    color: var(--warning);
  }

  .warning {
    padding: var(--space-4);
    border: 1px solid color-mix(in oklab, var(--danger) 35%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--danger) 8%, transparent);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--text-secondary);
  }

  .warning strong {
    color: var(--danger);
  }

  .warning p {
    margin-top: var(--space-2);
  }

  .acknowledgement {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .acknowledgement.disabled {
    opacity: 0.6;
    cursor: default;
  }

  .acknowledgement input {
    margin-top: 2px;
    accent-color: var(--accent);
  }

  .progress {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border-default);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .error {
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--danger) 10%, transparent);
    font-size: var(--text-xs);
    color: var(--danger);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
