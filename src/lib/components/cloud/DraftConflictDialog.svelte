<script lang="ts">
  /** Whole-document choice shown only after optimistic concurrency stops autosave. */
  import { persistenceCoordinator } from '$lib/persistence/coordinator.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, Icon } from '$lib/ui';

  type Choice = 'cloud' | 'local' | 'both';

  let dialog = $state<HTMLDialogElement | null>(null);
  let confirming = $state<Choice | null>(null);
  let seenId = $state<string | null>(null);

  const conflict = $derived(persistenceCoordinator.conflict);
  const set = $derived(workshop.adventure);

  $effect(() => {
    const current = conflict;
    if (!dialog) return;
    if (current) {
      if (seenId !== current.localId) {
        seenId = current.localId;
        confirming = null;
        workshop.conflictResolutionError = null;
      }
      if (!dialog.open) dialog.showModal();
    } else {
      seenId = null;
      confirming = null;
      if (dialog.open) dialog.close();
    }
  });

  function formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown time';
    return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  function confirmationTitle(choice: Choice): string {
    if (choice === 'cloud') return 'Replace this device’s pending changes?';
    if (choice === 'local') return 'Replace the online version?';
    return 'Save this device’s changes as a copy?';
  }

  function confirmationText(choice: Choice): string {
    if (choice === 'cloud') {
      return 'The complete online version will replace this device’s pending copy. This cannot be undone inside the app.';
    }
    if (choice === 'local') {
      return 'This device’s complete version will be saved as the next online revision. If the cloud changes again first, nothing will be overwritten and you will be asked again.';
    }
    return 'A new draft named “(conflict copy)” will preserve this device’s complete version. The original draft will then reopen with the current online version.';
  }

  async function resolve(choice: Choice): Promise<void> {
    if (choice === 'cloud') await workshop.resolveConflictWithCloud();
    else if (choice === 'local') await workshop.resolveConflictWithLocal();
    else await workshop.resolveConflictKeepBoth();
  }
</script>

<dialog
  bind:this={dialog}
  class="conflict-dialog"
  aria-labelledby="draft-conflict-title"
  oncancel={(event) => event.preventDefault()}
>
  {#if conflict}
    <div class="inner">
      <header class="head">
        <span class="warning-icon"><Icon name="rotate" size={18} /></span>
        <div>
          <span class="eyebrow">Cloud save paused</span>
          <h2 id="draft-conflict-title">Two versions need your choice</h2>
          <p>
            This set changed in another browser after this device last downloaded it. Neither
            complete version has been overwritten.
          </p>
        </div>
      </header>

      <div class="versions" aria-label="Conflicting versions">
        <section>
          <span class="version-label">This device</span>
          <strong>{set.name || 'Untitled Adventure'}</strong>
          <span>{set.characters.length} characters · {set.cards.length} cards</span>
          <span>Edited {formatDate(set.meta.updatedAt)}</span>
          <span class="revision">Based on online revision {conflict.baseRevision ?? 'unknown'}</span>
        </section>
        <section>
          <span class="version-label">Private cloud</span>
          <strong>Online version</strong>
          <span>Safely preserved in your account</span>
          <span class="revision">Revision {conflict.remoteRevision ?? 'unknown'}</span>
        </section>
      </div>

      {#if workshop.conflictResolutionError}
        <p class="error" role="alert">{workshop.conflictResolutionError}</p>
      {/if}

      {#if confirming}
        <section class="confirmation" aria-live="polite">
          <div>
            <h3>{confirmationTitle(confirming)}</h3>
            <p>{confirmationText(confirming)}</p>
          </div>
          <div class="confirmation-actions">
            <Button
              variant="ghost"
              disabled={workshop.conflictResolutionBusy}
              onclick={() => (confirming = null)}
            >Cancel</Button>
            <Button
              variant={confirming === 'cloud' || confirming === 'local' ? 'danger' : 'primary'}
              disabled={workshop.conflictResolutionBusy}
              onclick={() => void resolve(confirming as Choice)}
            >
              {workshop.conflictResolutionBusy ? 'Working…' : 'Confirm choice'}
            </Button>
          </div>
        </section>
      {:else}
        <div class="choices">
          <button type="button" onclick={() => (confirming = 'cloud')}>
            <span class="choice-icon"><Icon name="download" size={17} /></span>
            <span>
              <strong>Use cloud version</strong>
              <small>Replace this device’s pending changes with the complete online set.</small>
            </span>
          </button>
          <button type="button" onclick={() => (confirming = 'local')}>
            <span class="choice-icon"><Icon name="upload" size={17} /></span>
            <span>
              <strong>Keep this device’s version</strong>
              <small>Save this complete set over the known online revision.</small>
            </span>
          </button>
          <button type="button" onclick={() => (confirming = 'both')}>
            <span class="choice-icon"><Icon name="copy" size={17} /></span>
            <span>
              <strong>Save my changes as a separate copy</strong>
              <small>Preserve this device’s complete version, then reopen the online original.</small>
            </span>
          </button>
        </div>
      {/if}

      <footer>
        <span>Autosave remains stopped until you choose.</span>
        <Button
          variant="ghost"
          disabled={workshop.conflictResolutionBusy}
          onclick={() => void workshop.deferConflict()}
        >Decide later</Button>
      </footer>
    </div>
  {/if}
</dialog>

<style>
  .conflict-dialog {
    width: min(720px, calc(100vw - var(--space-6) * 2));
    max-height: calc(100vh - var(--space-6) * 2);
    padding: 0;
    overflow: auto;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    background: var(--surface-overlay);
    color: var(--text-default);
    box-shadow: var(--shadow-lg);
  }

  .conflict-dialog::backdrop {
    background: color-mix(in oklab, var(--grey-950) 74%, transparent);
  }

  .inner {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-6);
  }

  .head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-3);
  }

  .warning-icon,
  .choice-icon {
    display: grid;
    place-items: center;
    flex: none;
    border-radius: var(--radius-full);
  }

  .warning-icon {
    width: 38px;
    height: 38px;
    background: color-mix(in oklab, var(--warning) 16%, transparent);
    color: var(--warning);
  }

  .eyebrow,
  .version-label {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--warning);
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    margin-top: var(--space-1);
    font-family: var(--font-display);
    font-size: var(--text-xl);
    color: var(--text-primary);
  }

  .head p,
  .confirmation p {
    margin-top: var(--space-2);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    color: var(--text-muted);
  }

  .versions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .versions section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    padding: var(--space-4);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .versions strong {
    margin-block: var(--space-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .revision {
    color: var(--text-tertiary);
  }

  .choices {
    display: grid;
    gap: var(--space-2);
  }

  .choices button {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    color: inherit;
    text-align: left;
  }

  .choices button:hover,
  .choices button:focus-visible {
    border-color: var(--accent);
    background: var(--surface-hover);
  }

  .choice-icon {
    width: 34px;
    height: 34px;
    background: color-mix(in oklab, var(--accent) 13%, transparent);
    color: var(--accent);
  }

  .choices button > span:last-child {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .choices strong,
  .choices small {
    display: block;
  }

  .choices strong {
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .choices small {
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .confirmation {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-5);
    padding: var(--space-4);
    border: 1px solid color-mix(in oklab, var(--warning) 45%, var(--border-default));
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--warning) 8%, var(--surface-raised));
  }

  .confirmation h3 {
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .confirmation-actions {
    display: flex;
    gap: var(--space-2);
    flex: none;
  }

  .error {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--danger) 12%, transparent);
    font-size: var(--text-sm);
    color: var(--danger);
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  @media (max-width: 600px) {
    .inner {
      padding: var(--space-5);
    }

    .versions {
      grid-template-columns: 1fr;
    }

    .confirmation,
    footer {
      align-items: stretch;
      flex-direction: column;
    }

    .confirmation-actions {
      justify-content: flex-end;
    }
  }
</style>
