<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { CardId } from '$lib/cards/types';
  import { auth } from '$lib/cloud/auth.svelte';
  import { fetchPublishedCardHistory, type PublishedCardHistory } from '$lib/cloud/card-history';
  import type { SetId } from '$lib/sets/types';
  import { artworkAdjustmentView } from '$lib/state/artwork-adjustment-view.svelte';
  import { cardEditorView } from '$lib/state/card-editor-view.svelte';
  import { Button } from '$lib/ui';

  interface Props {
    setId: SetId;
    cardId: CardId;
    copy: number;
    disabled?: boolean;
  }

  let { setId, cardId, copy, disabled = false }: Props = $props();
  let publications = $state.raw<PublishedCardHistory[] | null>(null);
  let publicationId = $state('');
  let steps = $state<HTMLDivElement | null>(null);
  let loading = $state(false);
  let message = $state('');
  let pending: AbortController | null = null;

  const snapshot = $derived(cardEditorView.publishedRevision);
  const publication = $derived(publications?.find((entry) => entry.publication_id === publicationId) ?? publications?.[0]);
  const revisions = $derived(publication?.ranges.flatMap((range) =>
    Array.from({ length: range.last_revision - range.first_revision + 1 }, (_, index) => range.first_revision + index)
  ) ?? []);
  // The live draft is the final stop, after the latest published snapshot.
  const index = $derived(snapshot ? revisions.indexOf(snapshot.revision) : revisions.length);
  const canGoEarlier = $derived(!disabled && !loading && (publications === null || index > 0));

  onDestroy(() => {
    pending?.abort();
    cardEditorView.publishedRevision = null;
  });

  function showRevision(revision: number | undefined): void {
    if (revision === undefined) return;
    const range = publication?.ranges.find((entry) => entry.first_revision <= revision && revision <= entry.last_revision);
    if (!range) return;
    artworkAdjustmentView.end();
    cardEditorView.publishedRevision = { revision, frontPath: range.front_path, backPath: range.back_path };
  }

  async function earlier(): Promise<void> {
    if (!canGoEarlier) return;
    if (publications !== null) {
      showRevision(revisions[index - 1]);
      return;
    }
    if (!auth.signedIn) {
      message = 'Sign in with the account that published this set to view revisions.';
      return;
    }

    const controller = new AbortController();
    pending = controller;
    loading = true;
    message = '';
    try {
      const result = await fetchPublishedCardHistory(setId, cardId, copy, controller.signal);
      if (controller.signal.aborted) return;
      publications = result;
      if (!revisions.length) message = 'This card has no published revisions under this account.';
      else if (!disabled) showRevision(revisions.at(-1));
    } catch {
      if (!controller.signal.aborted) message = 'Published revisions are unavailable right now.';
    } finally {
      if (!controller.signal.aborted) loading = false;
    }
  }

  function backToDraft(): void {
    cardEditorView.publishedRevision = null;
    void tick().then(() => steps?.querySelector('button')?.focus({ preventScroll: true }));
  }

  function later(): void {
    if (!snapshot) return;
    if (index === revisions.length - 1) backToDraft();
    else showRevision(revisions[index + 1]);
  }

  function publicationLabel(entry: PublishedCardHistory): string {
    const scope = entry.scope === 'full' ? 'Full set' : entry.scope === 'hero' ? 'Hero publication' : 'Villain publication';
    return entry.publication_name + ' · ' + scope;
  }
</script>

<div class="history-controls">
  <div class="revision-steps" role="group" aria-label="Published revisions" bind:this={steps}>
    <Button size="sm" aria-label="Earlier published revision" aria-disabled={!canGoEarlier}
      onclick={() => void earlier()}>‹ Earlier</Button>
    <span class="numeric revision-label" aria-live="polite">
      {snapshot ? 'Revision ' + snapshot.revision : 'Draft'}
      {#if snapshot}<span class="sr-only">, published version, read-only</span>{/if}
    </span>
    <Button size="sm" aria-label="Later published revision" aria-disabled={!snapshot}
      onclick={later}>Later ›</Button>
  </div>

  {#if snapshot && publication}
    <div class="history-notice">
      <div>
        <strong>Published Revision {snapshot.revision} · Read-only</strong>
        <p>Latest published is Revision {publication.latest_revision}{copy > 1 ? ' · Copy ' + copy : ''}</p>
      </div>
      <Button size="sm" onclick={backToDraft}>Back to draft</Button>
    </div>
    {#if publications && publications.length > 1}
      <label class="publication-picker">
        <span>Publication</span>
        <select value={publication.publication_id} onchange={(event) => {
          publicationId = event.currentTarget.value;
          showRevision(revisions.at(-1));
        }}>
          {#each publications as entry (entry.publication_id)}
            <option value={entry.publication_id}>{publicationLabel(entry)}</option>
          {/each}
        </select>
      </label>
    {/if}
  {:else if loading || message}
    <p class="history-message" role="status">{loading ? 'Loading published revisions…' : message}</p>
  {/if}
</div>

<style>
  .history-controls {
    flex: none;
    border-bottom: 1px solid var(--border-subtle);
  }

  .revision-steps {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
  }

  .revision-steps :global(button:first-child) {
    justify-self: start;
  }

  .revision-steps :global(button:last-child) {
    justify-self: end;
  }

  .revision-steps :global(button[aria-disabled='true']) {
    opacity: 0.45;
    cursor: default;
  }

  .revision-label {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .history-notice,
  .publication-picker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-xs);
  }

  .history-notice {
    border-inline-start: var(--space-1) solid var(--warning);
    background: color-mix(in oklab, var(--warning) 14%, var(--surface-raised));
  }

  .publication-picker select {
    max-inline-size: 100%;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--text-primary);
  }

  .history-message {
    padding: var(--space-2) var(--space-4);
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }
</style>
