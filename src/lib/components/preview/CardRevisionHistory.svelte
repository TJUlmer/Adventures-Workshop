<script lang="ts">
  import type { CardId } from '$lib/cards/types';
  import { auth } from '$lib/cloud/auth.svelte';
  import { fetchPublishedCardHistory, type PublishedCardHistory } from '$lib/cloud/card-history';
  import { assetPrefix } from '$lib/cloud/sets';
  import type { SetId } from '$lib/sets/types';
  import { Button } from '$lib/ui';

  interface Props {
    setId: SetId;
    cardId: CardId;
    label: string;
    copy: number;
    onclose: () => void;
  }

  let { setId, cardId, label, copy, onclose }: Props = $props();
  let dialog = $state<HTMLDialogElement | null>(null);
  let publications = $state.raw<PublishedCardHistory[] | null>(null);
  let publicationId = $state('');
  let revision = $state<number | null>(null);
  let error = $state(false);

  const publication = $derived(publications?.find((entry) => entry.publication_id === publicationId) ?? publications?.[0]);
  const revisions = $derived(publication?.ranges.flatMap((range) =>
    Array.from({ length: range.last_revision - range.first_revision + 1 }, (_, index) => range.first_revision + index)
  ) ?? []);
  const viewedRevision = $derived(revision ?? revisions.at(-1));
  const revisionIndex = $derived(viewedRevision === undefined ? -1 : revisions.indexOf(viewedRevision));
  const snapshot = $derived(publication?.ranges.find((range) => viewedRevision !== undefined &&
    range.first_revision <= viewedRevision && viewedRevision <= range.last_revision));

  $effect(() => {
    if (dialog && !dialog.open) dialog.showModal();
  });

  $effect(() => {
    const userId = auth.user?.id;
    const currentSet = setId;
    const currentCard = cardId;
    const currentCopy = copy;
    publications = null;
    publicationId = '';
    revision = null;
    error = false;
    if (!userId) return;
    const controller = new AbortController();
    void fetchPublishedCardHistory(currentSet, currentCard, currentCopy, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) publications = result;
      })
      .catch(() => {
        if (!controller.signal.aborted) error = true;
      });
    return () => controller.abort();
  });

  function step(delta: number): void {
    const target = revisions[revisionIndex + delta];
    if (target !== undefined) revision = target;
  }

  function onkeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && /^[zy]$/i.test(event.key)) {
      // Workspace shortcuts live on window, outside the modal's inert subtree.
      event.stopPropagation();
      return;
    }
    if (event.target instanceof HTMLSelectElement || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    step(event.key === 'ArrowLeft' ? -1 : 1);
  }

  function publicationLabel(entry: PublishedCardHistory): string {
    if (entry.scope === 'full') return `${entry.publication_name} · Full set`;
    return `${entry.publication_name} · ${entry.scope === 'hero' ? 'Hero' : 'Villain'} publication`;
  }
</script>

<dialog class="history-dialog ui-dialog-viewport" bind:this={dialog}
  aria-labelledby="card-revision-title" {onclose} {onkeydown}>
  <div class="ui-dialog-frame">
    <header class="history-header">
      <div>
        <h2 id="card-revision-title">Revision history</h2>
        <p>{label}{copy > 1 ? ` · Copy ${copy}` : ''}</p>
      </div>
      <Button size="sm" onclick={() => dialog?.close()}>Back to draft</Button>
    </header>

    {#if publication && snapshot}
      <div class="history-notice" role="status">
        <strong>Viewing {viewedRevision === publication.latest_revision ? 'a' : 'an older'} published version · Read-only</strong>
        <span>Published Revision {viewedRevision} · Latest published is Revision {publication.latest_revision}</span>
      </div>
      <div class="history-tools">
        {#if publications && publications.length > 1}
          <label>
            <span>Publication</span>
            <select value={publication.publication_id} onchange={(event) => {
              publicationId = event.currentTarget.value;
              revision = null;
            }}>
              {#each publications as entry (entry.publication_id)}
                <option value={entry.publication_id}>{publicationLabel(entry)}</option>
              {/each}
            </select>
          </label>
        {/if}
        <div class="revision-steps" role="group" aria-label="Published revisions">
          <Button size="sm" aria-label="Earlier published revision" disabled={revisionIndex <= 0}
            onclick={() => step(-1)}>‹ Earlier</Button>
          <span class="numeric">Revision {viewedRevision}</span>
          <Button size="sm" aria-label="Later published revision" disabled={revisionIndex >= revisions.length - 1}
            onclick={() => step(1)}>Later ›</Button>
        </div>
      </div>

      <div class="history-stage ui-dialog-scroll">
        {#key `${publication.publication_id}:${viewedRevision}`}
          <img src={`${assetPrefix()}${snapshot.front_path}`} alt={`${label}, published revision ${viewedRevision}`} />
          {#if snapshot.back_path}
            <img src={`${assetPrefix()}${snapshot.back_path}`} alt={`${label}, reverse of published revision ${viewedRevision}`} />
          {/if}
        {/key}
      </div>
    {:else}
      <p class="history-message" role="status">
        {#if !auth.signedIn}
          Sign in with the account that published this set to view revisions.
        {:else if error}
          Published revisions are unavailable right now.
        {:else if publications === null}
          Loading published revisions…
        {:else}
          This card has no published revisions under this account.
        {/if}
      </p>
    {/if}
  </div>
</dialog>

<style>
  .history-dialog {
    --ui-dialog-inline-size: 760px;
    visibility: visible;
    pointer-events: auto;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    color: var(--text-primary);
    box-shadow: var(--shadow-lg);
  }

  .history-dialog::backdrop {
    background: color-mix(in oklab, var(--grey-1000) 72%, transparent);
  }

  .history-header,
  .history-tools {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
    padding: var(--space-3) var(--space-4);
  }

  .history-header h2 {
    font-family: var(--font-display);
    font-size: var(--text-lg);
  }

  .history-header p,
  .history-tools {
    font-size: var(--text-xs);
  }

  .history-notice {
    flex: none;
    display: grid;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-4);
    border-inline-start: var(--space-1) solid var(--warning);
    background: color-mix(in oklab, var(--warning) 14%, var(--surface-raised));
    font-size: var(--text-xs);
  }

  .history-tools label,
  .revision-steps {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .history-tools label {
    min-inline-size: 0;
  }

  .history-tools select {
    max-inline-size: 100%;
    min-height: var(--touch-target);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--text-primary);
  }

  .history-stage {
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-sunken);
  }

  .history-stage img {
    display: block;
    max-inline-size: min(100%, 460px);
    block-size: auto;
  }

  .history-message {
    padding: var(--space-4);
    color: var(--text-secondary);
  }
</style>
