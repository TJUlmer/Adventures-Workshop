<script lang="ts">
  /**
   * The collection team's private, deck-by-deck conversation.
   *
   * This component belongs only in an authenticated working mode. It also
   * guards itself so accidentally mounting it on the showcase for a signed-in
   * stranger still renders nothing; RLS remains the final boundary behind it.
   * Every thread arrives in one collection-wide request and is grouped here,
   * rather than issuing one request for every accepted deck.
   */
  import {
    createCollectionDeckComment,
    deleteCollectionDeckComment,
    editCollectionDeckComment,
    listCollectionDeckComments
  } from '$lib/cloud/collections';
  import type { CollectionDeckComment, CollectionMembership } from '$lib/cloud/collections';

  interface Props {
    collectionId: string;
    memberships: readonly CollectionMembership[];
    currentUserId: string;
    organizer: boolean;
    workspaceCurrent: boolean;
  }

  let { collectionId, memberships, currentUserId, organizer, workspaceCurrent }: Props = $props();

  const accepted = $derived(memberships.filter((row) => row.status === 'accepted'));
  const canRender = $derived(
    currentUserId.length > 0 && (organizer || accepted.length > 0)
  );

  let comments = $state<CollectionDeckComment[]>([]);
  let loading = $state(false);
  let loadFailed = $state(false);
  let message = $state<string | null>(null);
  let openSetId = $state<string | null>(null);
  let draft = $state('');
  let editingId = $state<string | null>(null);
  let editDraft = $state('');
  let deletingId = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let loadedKey = '';
  let loadGeneration = 0;
  let mutationGeneration = 0;

  const commentsBySet = $derived.by(() => {
    const grouped = new Map<string, CollectionDeckComment[]>();
    for (const comment of comments) {
      const thread = grouped.get(comment.set_id);
      if (thread) thread.push(comment);
      else grouped.set(comment.set_id, [comment]);
    }
    return grouped;
  });

  function ordered(rows: readonly CollectionDeckComment[]): CollectionDeckComment[] {
    return [...rows].sort(
      (left, right) =>
        left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
    );
  }

  async function load(id: string, generation: number): Promise<void> {
    loading = true;
    loadFailed = false;
    message = null;
    try {
      const rows = await listCollectionDeckComments(id);
      if (generation !== loadGeneration || id !== collectionId) return;
      comments = ordered(rows);
    } catch (error) {
      if (generation !== loadGeneration || id !== collectionId) return;
      loadFailed = true;
      message = error instanceof Error ? error.message : 'Could not load the deck discussions.';
    } finally {
      if (generation === loadGeneration && id === collectionId) loading = false;
    }
  }

  $effect(() => {
    const key = canRender && collectionId ? `${collectionId}:${currentUserId}` : '';
    if (key === loadedKey) return;
    loadedKey = key;
    const generation = ++loadGeneration;
    comments = [];
    loadFailed = false;
    message = null;
    if (!key) {
      loading = false;
      return;
    }
    void load(collectionId, generation);
  });

  /* Discussion is shared state from somebody else's browser. Refreshing when
     this tab becomes useful again keeps a live conversation from looking
     frozen, while the interval covers a workspace left continuously open. */
  $effect(() => {
    const active = canRender && collectionId && currentUserId;
    if (!active) return;
    const refreshWhenVisible = (): void => {
      if (document.visibilityState === 'visible' && !loading && !busy) {
        void load(collectionId, ++loadGeneration);
      }
    };
    const interval = window.setInterval(refreshWhenVisible, 45_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  });

  $effect(() => {
    void collectionId;
    void currentUserId;
    mutationGeneration += 1;
    openSetId = null;
    draft = '';
    editingId = null;
    editDraft = '';
    deletingId = null;
    busy = null;
  });

  $effect(() => {
    if (openSetId && !accepted.some((row) => row.set_id === openSetId)) {
      openSetId = null;
      draft = '';
      editingId = null;
      deletingId = null;
    }
  });

  function toggleThread(setId: string): void {
    if (openSetId === setId) {
      openSetId = null;
      draft = '';
      editingId = null;
      deletingId = null;
      return;
    }
    openSetId = setId;
    draft = '';
    editingId = null;
    deletingId = null;
    message = null;
  }

  function retry(): void {
    if (!canRender || !collectionId || loading) return;
    void load(collectionId, ++loadGeneration);
  }

  async function post(setId: string): Promise<void> {
    if (busy || !canRender || !workspaceCurrent) return;
    const generation = mutationGeneration;
    busy = `post-${setId}`;
    message = null;
    try {
      const created = await createCollectionDeckComment(collectionId, setId, draft);
      if (generation !== mutationGeneration) return;
      comments = ordered([...comments, created]);
      draft = '';
    } catch (error) {
      if (generation !== mutationGeneration) return;
      message = error instanceof Error ? error.message : 'That comment did not go through.';
    } finally {
      if (generation === mutationGeneration) busy = null;
    }
  }

  function beginEdit(comment: CollectionDeckComment): void {
    editingId = comment.id;
    editDraft = comment.body;
    deletingId = null;
    message = null;
  }

  function cancelEdit(): void {
    editingId = null;
    editDraft = '';
  }

  async function saveEdit(commentId: string): Promise<void> {
    if (busy || editingId !== commentId || !workspaceCurrent) return;
    const generation = mutationGeneration;
    busy = `edit-${commentId}`;
    message = null;
    try {
      const updated = await editCollectionDeckComment(commentId, editDraft);
      if (generation !== mutationGeneration) return;
      comments = comments.map((comment) => (comment.id === updated.id ? updated : comment));
      cancelEdit();
    } catch (error) {
      if (generation !== mutationGeneration) return;
      message = error instanceof Error ? error.message : 'That edit did not go through.';
    } finally {
      if (generation === mutationGeneration) busy = null;
    }
  }

  async function remove(commentId: string): Promise<void> {
    if (busy || deletingId !== commentId || !workspaceCurrent) return;
    const generation = mutationGeneration;
    busy = `delete-${commentId}`;
    message = null;
    try {
      await deleteCollectionDeckComment(commentId);
      if (generation !== mutationGeneration) return;
      comments = comments.filter((comment) => comment.id !== commentId);
      if (editingId === commentId) cancelEdit();
      deletingId = null;
    } catch (error) {
      if (generation !== mutationGeneration) return;
      message = error instanceof Error ? error.message : 'That comment could not be deleted.';
    } finally {
      if (generation === mutationGeneration) busy = null;
    }
  }

  function authorName(comment: CollectionDeckComment): string {
    return comment.author?.display_name.trim() || 'Anonymous creator';
  }

  function authorInitial(comment: CollectionDeckComment): string {
    return authorName(comment).slice(0, 1).toUpperCase() || '?';
  }

  function commentDate(comment: CollectionDeckComment): string {
    const date = new Date(comment.created_at);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }
</script>

{#if canRender}
  <section class="discussion" aria-labelledby="collection-deck-discussion-heading">
    <header class="discussion-heading">
      <div>
        <p class="eyebrow">{organizer ? 'Organiser workspace' : 'Creator workspace'}</p>
        <h2 id="collection-deck-discussion-heading">Deck discussions</h2>
      </div>
      <div class="discussion-tools">
        <p class="privacy">Private to the collection team. These comments never appear on the public page.</p>
        <button type="button" class="button" onclick={retry} disabled={loading || busy !== null}>
          {loading ? 'Refreshing…' : 'Refresh discussions'}
        </button>
      </div>
    </header>

    {#if message}
      <p class:error={loadFailed} class="message" role={loadFailed ? 'alert' : 'status'}>{message}</p>
    {/if}
    {#if !workspaceCurrent}
      <p class="message" role="status">
        Project activity is not current. Your draft is safe; refresh the project before posting.
      </p>
    {/if}

    {#if accepted.length === 0}
      <p class="empty">A private discussion will appear here after the first deck is accepted.</p>
    {:else}
      <ul class="threads">
        {#each accepted as membership (membership.set_id)}
          {@const thread = commentsBySet.get(membership.set_id) ?? []}
          {@const expanded = openSetId === membership.set_id}
          <li class="thread">
            <button
              type="button"
              class="thread-toggle"
              aria-expanded={expanded}
              aria-controls={`collection-discussion-${membership.set_id}`}
              onclick={() => toggleThread(membership.set_id)}
            >
              <span class="deck-identity">
                <strong>{membership.set?.name || 'Untitled deck'}</strong>
                <span>{membership.set?.author?.display_name || 'Anonymous creator'}</span>
              </span>
              <span class="count">
                {thread.length} {thread.length === 1 ? 'comment' : 'comments'}
              </span>
            </button>

            {#if expanded}
              <div class="thread-body" id={`collection-discussion-${membership.set_id}`}>
                {#if loading}
                  <p class="empty">Loading discussion…</p>
                {:else if loadFailed}
                  <button type="button" class="button" onclick={retry} disabled={loading}>
                    Try again
                  </button>
                {:else}
                  {#if thread.length === 0}
                    <p class="empty">No comments yet. Start the conversation for this deck.</p>
                  {:else}
                    <ol class="comments">
                      {#each thread as comment (comment.id)}
                        <li class="comment">
                          <span class="avatar" aria-hidden="true">
                            {#if comment.author?.avatar_url}
                              <img src={comment.author.avatar_url} alt="" loading="lazy" />
                            {:else}
                              {authorInitial(comment)}
                            {/if}
                          </span>
                          <div class="comment-content">
                            <div class="comment-meta">
                              <strong>{authorName(comment)}</strong>
                              <time datetime={comment.created_at}>{commentDate(comment)}</time>
                              {#if comment.updated_at !== comment.created_at}<span>edited</span>{/if}
                            </div>

                            {#if editingId === comment.id}
                              <form
                                class="comment-form edit-form"
                                onsubmit={(event) => {
                                  event.preventDefault();
                                  void saveEdit(comment.id);
                                }}
                              >
                                <label class="sr-only" for={`edit-collection-comment-${comment.id}`}>
                                  Edit comment
                                </label>
                                  <textarea
                                  id={`edit-collection-comment-${comment.id}`}
                                  bind:value={editDraft}
                                  maxlength={2000}
                                  rows={3}
                                  disabled={busy !== null || !workspaceCurrent}
                                ></textarea>
                                <span class="form-actions">
                                  <button
                                    type="submit"
                                    class="button primary"
                                    disabled={busy !== null || !workspaceCurrent || editDraft.trim().length === 0}
                                  >
                                    {busy === `edit-${comment.id}` ? 'Saving…' : 'Save'}
                                  </button>
                                  <button type="button" class="button" onclick={cancelEdit} disabled={busy !== null}>
                                    Cancel
                                  </button>
                                </span>
                              </form>
                            {:else}
                              <p class="comment-body">{comment.body}</p>
                              {#if comment.author_id === currentUserId}
                                <div class="comment-actions">
                                  {#if deletingId === comment.id}
                                    <span>Delete this comment?</span>
                                    <button
                                      type="button"
                                      class="text-button danger"
                                      disabled={busy !== null || !workspaceCurrent}
                                      onclick={() => void remove(comment.id)}
                                    >
                                      {busy === `delete-${comment.id}` ? 'Deleting…' : 'Delete'}
                                    </button>
                                    <button
                                      type="button"
                                      class="text-button"
                                      disabled={busy !== null}
                                      onclick={() => (deletingId = null)}
                                    >
                                      Cancel
                                    </button>
                                  {:else}
                                    <button
                                      type="button"
                                      class="text-button"
                                      disabled={!workspaceCurrent}
                                      onclick={() => beginEdit(comment)}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      class="text-button"
                                      disabled={!workspaceCurrent}
                                      onclick={() => {
                                        deletingId = comment.id;
                                        editingId = null;
                                      }}
                                    >
                                      Delete
                                    </button>
                                  {/if}
                                </div>
                              {/if}
                            {/if}
                          </div>
                        </li>
                      {/each}
                    </ol>
                  {/if}

                  <form
                    class="comment-form new-comment"
                    onsubmit={(event) => {
                      event.preventDefault();
                      void post(membership.set_id);
                    }}
                  >
                    <label for={`new-collection-comment-${membership.set_id}`}>Add to this discussion</label>
                    <textarea
                      id={`new-collection-comment-${membership.set_id}`}
                      bind:value={draft}
                      maxlength={2000}
                      rows={3}
                      placeholder="Share feedback, a playtest note, or a question…"
                      disabled={busy !== null || !workspaceCurrent}
                    ></textarea>
                    <span class="form-footer">
                      <span>{draft.length.toLocaleString()} / 2,000</span>
                      <button
                        type="submit"
                        class="button primary"
                        disabled={busy !== null || !workspaceCurrent || draft.trim().length === 0}
                      >
                        {busy === `post-${membership.set_id}` ? 'Posting…' : 'Post comment'}
                      </button>
                    </span>
                  </form>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .discussion {
    display: grid;
    gap: var(--space-5);
    padding: var(--space-6);
    border: var(--space-px) solid var(--border-default);
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    box-shadow: var(--shadow-sm);
  }

  .discussion-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--space-6);
  }

  .discussion-heading h2,
  .discussion-heading p,
  .comment-body,
  .empty,
  .message {
    margin: var(--space-0);
  }

  .discussion-heading h2 {
    color: var(--text-primary);
    font-family: var(--font-display);
    font-size: var(--text-xl);
  }

  .eyebrow {
    margin-bottom: var(--space-1) !important;
    color: var(--text-accent);
    font-size: var(--text-2xs);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
  }

  .privacy {
    max-width: calc(var(--space-10) * 6);
    color: var(--text-tertiary);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    text-align: right;
  }

  .discussion-tools {
    display: grid;
    justify-items: end;
    gap: var(--space-2);
  }

  .threads,
  .comments {
    margin: var(--space-0);
    padding: var(--space-0);
    list-style: none;
  }

  .threads {
    display: grid;
    gap: var(--space-3);
  }

  .thread {
    overflow: hidden;
    border: var(--space-px) solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-base);
  }

  .thread-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--space-4);
    border: 0;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .thread-toggle:hover {
    background: var(--surface-hover);
  }

  .thread-toggle:focus-visible,
  .button:focus-visible,
  .text-button:focus-visible,
  textarea:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .deck-identity {
    display: grid;
    gap: var(--space-1);
  }

  .deck-identity strong {
    font-size: var(--text-md);
  }

  .deck-identity span,
  .count,
  .empty,
  .message {
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .count {
    flex: none;
    margin-left: var(--space-4);
  }

  .thread-body {
    display: grid;
    gap: var(--space-5);
    padding: var(--space-5);
    border-top: var(--space-px) solid var(--border-subtle);
    background: var(--surface-raised);
  }

  .comments {
    display: grid;
    gap: var(--space-4);
  }

  .comment {
    display: grid;
    grid-template-columns: var(--space-7) minmax(0, 1fr);
    gap: var(--space-3);
  }

  .avatar {
    display: grid;
    place-items: center;
    width: var(--space-7);
    height: var(--space-7);
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--text-accent);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .comment-content {
    min-width: 0;
  }

  .comment-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
    margin-bottom: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .comment-meta strong {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .comment-body {
    color: var(--text-primary);
    font-size: var(--text-base);
    line-height: var(--leading-normal);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .comment-actions,
  .form-actions,
  .form-footer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .comment-actions {
    margin-top: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .comment-form {
    display: grid;
    gap: var(--space-2);
  }

  .comment-form label {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  textarea {
    width: 100%;
    min-height: calc(var(--space-9) * 2);
    resize: vertical;
    padding: var(--space-3);
    border: var(--space-px) solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    color: var(--text-primary);
    font: inherit;
    line-height: var(--leading-normal);
  }

  textarea::placeholder {
    color: var(--text-muted);
  }

  .new-comment {
    padding-top: var(--space-4);
    border-top: var(--space-px) solid var(--border-subtle);
  }

  .form-footer {
    justify-content: space-between;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .button {
    justify-self: start;
    padding: var(--space-2) var(--space-3);
    border: var(--space-px) solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-base);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
  }

  .button:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .button.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--text-on-accent);
  }

  .button.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .button:disabled,
  .text-button:disabled,
  textarea:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .text-button {
    padding: var(--space-0);
    border: 0;
    background: transparent;
    color: var(--text-accent);
    font: inherit;
    cursor: pointer;
  }

  .text-button.danger {
    color: var(--danger);
  }

  .message {
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
  }

  .message.error {
    color: var(--danger);
  }

  .sr-only {
    position: absolute;
    width: var(--space-px);
    height: var(--space-px);
    padding: var(--space-0);
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
