<script lang="ts">
  import {
    createCollectionMilestone,
    createCollectionMilestones,
    deleteCollectionMilestone,
    listCollectionMilestones,
    setCollectionMilestoneComplete,
    updateCollectionMilestone
  } from '$lib/cloud/collections';
  import type {
    CollectionMilestone,
    CollectionMilestoneFields
  } from '$lib/cloud/collections';

  interface Props {
    collectionId: string;
    canManage: boolean;
  }

  let { collectionId, canManage }: Props = $props();

  let milestones = $state<CollectionMilestone[]>([]);
  let loading = $state(true);
  let failed = $state(false);
  let reload = $state(0);
  let generation = 0;
  let busy = $state<string | null>(null);
  let notice = $state<string | null>(null);

  let title = $state('');
  let note = $state('');
  let targetDate = $state('');

  let editingId = $state<string | null>(null);
  let editTitle = $state('');
  let editNote = $state('');
  let editTargetDate = $state('');
  let confirmingDelete = $state<string | null>(null);

  $effect(() => {
    void reload;
    const id = collectionId;
    const request = ++generation;
    loading = true;
    failed = false;
    void listCollectionMilestones(id)
      .then((rows) => {
        if (request === generation && collectionId === id) milestones = rows;
      })
      .catch(() => {
        if (request === generation && collectionId === id) failed = true;
      })
      .finally(() => {
        if (request === generation && collectionId === id) loading = false;
      });
  });

  const completedCount = $derived(milestones.filter((row) => row.completed_at).length);
  const nextMilestoneId = $derived(milestones.find((row) => !row.completed_at)?.id ?? '');

  function dateParts(value: string): [number, number, number] | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }

  function formatDate(value: string): string {
    const parts = dateParts(value);
    if (!parts) return value;
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(new Date(parts[0], parts[1] - 1, parts[2]));
  }

  function timingLabel(row: CollectionMilestone): string {
    if (row.completed_at) return 'Complete';
    const parts = dateParts(row.target_date);
    if (!parts) return '';
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const target = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    const days = Math.round((target - today) / 86_400_000);
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    if (days > 1) return `${days} days away`;
    if (days === -1) return '1 day overdue';
    return `${Math.abs(days)} days overdue`;
  }

  function isOverdue(row: CollectionMilestone): boolean {
    if (row.completed_at) return false;
    const parts = dateParts(row.target_date);
    if (!parts) return false;
    const now = new Date();
    return Date.UTC(parts[0], parts[1] - 1, parts[2]) <
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function goalDateAfter(months: number): string {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth() + months, 1);
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const date = new Date(first.getFullYear(), first.getMonth(), Math.min(today.getDate(), lastDay));
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  async function mutate(key: string, action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = key;
    notice = null;
    confirmingDelete = null;
    try {
      await action();
      reload += 1;
    } catch (error) {
      notice = error instanceof Error ? error.message : 'The timeline could not be updated.';
    } finally {
      busy = null;
    }
  }

  function addMilestone(): void {
    void mutate('add', async () => {
      await createCollectionMilestone(collectionId, { title, note, targetDate });
      title = '';
      note = '';
      targetDate = '';
    });
  }

  function addStarterTimeline(): void {
    const starter: CollectionMilestoneFields[] = [
      {
        title: 'Initial drafts',
        note: 'Every contributor has a first playable draft ready to share with the team.',
        targetDate: goalDateAfter(2)
      },
      {
        title: 'Testing',
        note: 'Focused playtesting is complete and the decks are ready for final refinements.',
        targetDate: goalDateAfter(6)
      },
      {
        title: 'Visuals',
        note: 'Artwork, graphic design, and final presentation are in place.',
        targetDate: goalDateAfter(8)
      },
      {
        title: 'Teaser season',
        note: 'Begin sharing previews and introducing the collection to the community.',
        targetDate: goalDateAfter(9)
      },
      {
        title: 'Reveal',
        note: 'Publish the finished collection.',
        targetDate: goalDateAfter(10)
      }
    ];
    void mutate('starter', () => createCollectionMilestones(collectionId, starter));
  }

  function startEditing(row: CollectionMilestone): void {
    editingId = row.id;
    editTitle = row.title;
    editNote = row.note;
    editTargetDate = row.target_date;
    confirmingDelete = null;
    notice = null;
  }

  function saveEdit(row: CollectionMilestone): void {
    void mutate(`edit-${row.id}`, async () => {
      await updateCollectionMilestone(row.id, {
        title: editTitle,
        note: editNote,
        targetDate: editTargetDate
      });
      editingId = null;
    });
  }

  function toggleComplete(row: CollectionMilestone): void {
    void mutate(`complete-${row.id}`, () =>
      setCollectionMilestoneComplete(row.id, !row.completed_at)
    );
  }

  function remove(row: CollectionMilestone): void {
    if (confirmingDelete !== row.id) {
      confirmingDelete = row.id;
      return;
    }
    void mutate(`delete-${row.id}`, () => deleteCollectionMilestone(row.id));
  }
</script>

<section class="timeline-panel" aria-labelledby="collection-timeline-heading">
  <header class="timeline-heading">
    <div>
      <p class="eyebrow">Project plan</p>
      <h2 id="collection-timeline-heading">Timeline</h2>
      <p>Shared goal dates keep drafting, testing, visuals, and the reveal moving together.</p>
    </div>
    {#if milestones.length > 0}
      <span class="timeline-progress">{completedCount} of {milestones.length} complete</span>
    {/if}
  </header>

  {#if notice}<p class="timeline-notice" role="alert">{notice}</p>{/if}

  {#if loading}
    <p class="empty">Loading the project timeline…</p>
  {:else if failed}
    <div class="empty error">
      <p>We couldn’t load the project timeline.</p>
      <button type="button" class="btn" onclick={() => (reload += 1)}>Try again</button>
    </div>
  {:else if milestones.length === 0}
    <div class="empty">
      <strong>No goal dates yet</strong>
      <p>A common plan moves from initial drafts through testing, visuals, teasers, and reveal.</p>
      {#if canManage}
        <button
          type="button"
          class="btn primary"
          disabled={busy !== null}
          onclick={addStarterTimeline}
        >{busy === 'starter' ? 'Adding timeline…' : 'Use the suggested timeline'}</button>
      {:else}
        <p>An organizer can add the project’s milestones here.</p>
      {/if}
    </div>
  {:else}
    <ol class="milestones">
      {#each milestones as row (row.id)}
        <li
          class:complete={Boolean(row.completed_at)}
          class:overdue={isOverdue(row)}
          class:next={row.id === nextMilestoneId}
        >
          <span class="marker" aria-hidden="true"></span>
          {#if editingId === row.id}
            <div class="milestone-editor">
              <label>
                <span>Milestone</span>
                <input type="text" maxlength="120" bind:value={editTitle} />
              </label>
              <label>
                <span>Goal date</span>
                <input type="date" bind:value={editTargetDate} />
              </label>
              <label class="wide">
                <span>Description</span>
                <textarea rows="3" maxlength="400" bind:value={editNote}></textarea>
                <small>{editNote.length}/400</small>
              </label>
              <div class="actions wide">
                <button
                  type="button"
                  class="btn primary"
                  disabled={busy !== null || !editTitle.trim() || !editTargetDate}
                  onclick={() => saveEdit(row)}
                >{busy === `edit-${row.id}` ? 'Saving…' : 'Save changes'}</button>
                <button type="button" class="btn" disabled={busy !== null} onclick={() => (editingId = null)}>
                  Cancel
                </button>
              </div>
            </div>
          {:else}
            <div class="milestone-copy">
              <div class="milestone-title">
                <h3>{row.title}</h3>
                <span>{timingLabel(row)}</span>
              </div>
              <time datetime={row.target_date}>{formatDate(row.target_date)}</time>
              {#if row.note}<p>{row.note}</p>{/if}
            </div>
            {#if canManage}
              <div class="milestone-actions">
                <button type="button" class="btn" disabled={busy !== null} onclick={() => toggleComplete(row)}>
                  {row.completed_at ? 'Reopen' : 'Mark complete'}
                </button>
                <button type="button" class="btn" disabled={busy !== null} onclick={() => startEditing(row)}>
                  Edit
                </button>
                <button
                  type="button"
                  class:danger={confirmingDelete === row.id}
                  class="btn"
                  disabled={busy !== null}
                  onclick={() => remove(row)}
                >{busy === `delete-${row.id}`
                    ? 'Deleting…'
                    : confirmingDelete === row.id ? 'Confirm delete' : 'Delete'}</button>
              </div>
            {/if}
          {/if}
        </li>
      {/each}
    </ol>
  {/if}

  {#if canManage && !loading && !failed}
    <form class="add-milestone" onsubmit={(event) => { event.preventDefault(); addMilestone(); }}>
      <div class="add-heading">
        <strong>Add a milestone</strong>
        <span>Goal dates can be adjusted as the project develops.</span>
      </div>
      <label>
        <span>Milestone</span>
        <input type="text" maxlength="120" bind:value={title} placeholder="Final playtest" />
      </label>
      <label>
        <span>Goal date</span>
        <input type="date" bind:value={targetDate} />
      </label>
      <label class="wide">
        <span>Description <small>optional</small></span>
        <textarea
          rows="3"
          maxlength="400"
          bind:value={note}
          placeholder="What should the team have finished by this point?"
        ></textarea>
        <small>{note.length}/400</small>
      </label>
      <button
        type="submit"
        class="btn primary"
        disabled={busy !== null || !title.trim() || !targetDate}
      >{busy === 'add' ? 'Adding…' : 'Add milestone'}</button>
    </form>
  {/if}
</section>

<style>
  .timeline-panel {
    display: grid;
    gap: var(--space-5);
    padding: var(--space-6);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xl);
    background: var(--surface-raised);
    box-shadow: var(--shadow-card);
  }

  .timeline-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-5);
  }

  .timeline-heading h2,
  .timeline-heading p,
  .milestone-copy h3,
  .milestone-copy p,
  .empty p {
    margin: 0;
  }

  .timeline-heading h2 {
    font-size: var(--text-2xl);
  }

  .timeline-heading > div > p:last-child {
    max-width: 42rem;
    margin-top: var(--space-2);
    color: var(--text-muted);
  }

  .eyebrow {
    color: var(--text-accent);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-widest);
    text-transform: uppercase;
  }

  .timeline-progress {
    flex: none;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-full);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .timeline-notice {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border-left: var(--space-1) solid var(--danger);
    background: color-mix(in oklab, var(--danger) 8%, var(--surface-inset));
    color: var(--text-secondary);
  }

  .empty {
    display: grid;
    justify-items: start;
    gap: var(--space-3);
    padding: var(--space-6);
    border: 1px dashed var(--border-default);
    border-radius: var(--radius-lg);
    background: var(--surface-inset);
    color: var(--text-muted);
  }

  .empty strong {
    color: var(--text-primary);
    font-size: var(--text-lg);
  }

  .empty.error {
    border-color: color-mix(in oklab, var(--danger) 50%, var(--border-default));
  }

  .milestones {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .milestones li {
    --timeline-colour: var(--border-strong);
    position: relative;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-4);
    min-height: 7rem;
    padding: 0 0 var(--space-6) var(--space-8);
  }

  .milestones li::before {
    position: absolute;
    top: var(--space-3);
    bottom: calc(-1 * var(--space-3));
    left: 9px;
    width: 2px;
    background: var(--border-default);
    content: '';
  }

  .milestones li:last-child {
    min-height: auto;
    padding-bottom: 0;
  }

  .milestones li:last-child::before {
    display: none;
  }

  .milestones li.next {
    --timeline-colour: var(--accent);
  }

  .milestones li.complete {
    --timeline-colour: var(--success);
  }

  .milestones li.overdue {
    --timeline-colour: var(--danger);
  }

  .marker {
    position: absolute;
    top: var(--space-1);
    left: 0;
    width: 20px;
    height: 20px;
    border: 4px solid var(--surface-raised);
    border-radius: var(--radius-full);
    background: var(--timeline-colour);
    box-shadow: 0 0 0 1px var(--timeline-colour);
  }

  .milestone-copy {
    display: grid;
    align-content: start;
    gap: var(--space-2);
  }

  .milestone-title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-3);
  }

  .milestone-title h3 {
    font-size: var(--text-lg);
  }

  .milestone-title span {
    color: var(--timeline-colour);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }

  .milestone-copy time {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  .milestone-copy p {
    max-width: 48rem;
    color: var(--text-muted);
    line-height: var(--leading-relaxed);
  }

  .milestone-actions {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .milestone-editor,
  .add-milestone {
    display: grid;
    grid-template-columns: minmax(12rem, 1fr) minmax(10rem, 0.45fr);
    gap: var(--space-4);
  }

  .milestone-editor {
    grid-column: 1 / -1;
  }

  .add-milestone {
    padding-top: var(--space-5);
    border-top: 1px solid var(--border-default);
  }

  .add-heading,
  .wide {
    grid-column: 1 / -1;
  }

  .add-heading {
    display: grid;
    gap: var(--space-1);
  }

  .add-heading span {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  label {
    display: grid;
    gap: var(--space-2);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  label > span {
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }

  label small {
    color: var(--text-muted);
    font-weight: var(--weight-normal);
    letter-spacing: normal;
    text-transform: none;
  }

  input,
  textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-inset);
    color: var(--text-primary);
    font: inherit;
  }

  input {
    min-height: 2.65rem;
    padding: 0 var(--space-3);
  }

  textarea {
    min-height: 5rem;
    padding: var(--space-3);
    resize: vertical;
  }

  input:focus-visible,
  textarea:focus-visible {
    border-color: var(--accent);
    outline: 2px solid color-mix(in oklab, var(--accent) 28%, transparent);
    outline-offset: 1px;
  }

  .actions {
    display: flex;
    gap: var(--space-2);
  }

  .btn {
    min-height: 2.25rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  .btn.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--text-on-accent);
  }

  .btn.danger {
    border-color: var(--danger);
    color: var(--danger);
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  @media (max-width: 720px) {
    .timeline-panel {
      padding: var(--space-4);
    }

    .timeline-heading,
    .milestones li {
      grid-template-columns: 1fr;
    }

    .timeline-heading {
      display: grid;
    }

    .timeline-progress {
      justify-self: start;
    }

    .milestone-actions {
      justify-content: flex-start;
    }

    .milestone-editor,
    .add-milestone {
      grid-template-columns: 1fr;
    }

    .wide,
    .add-heading {
      grid-column: auto;
    }
  }
</style>
