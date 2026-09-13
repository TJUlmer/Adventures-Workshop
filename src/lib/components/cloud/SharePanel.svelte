<script lang="ts">
  /**
   * Publishing the open set, and managing what was published.
   *
   * Sits inside Export because that is what it is: one more thing to do with a
   * finished set. It is not a sync toggle and must not read like one — the
   * working draft is private, publishing copies it into a separate snapshot,
   * and nothing here ever writes back into the set the author is editing.
   */
  import { onDestroy } from 'svelte';
  import { characterLabel } from '$lib/characters/factory';
  import { auth } from '$lib/cloud/auth.svelte';
  import { cloudEnabled } from '$lib/cloud/config';
  import {
    listMyPublishedSets,
    publishSet,
    publishSize,
    setVisibility,
    shareUrl,
    unpublishSet
  } from '$lib/cloud/sets';
  import type { PublishedSet, Visibility } from '$lib/cloud/sets';
  import { renderSocialImage } from '$lib/cloud/social-image';
  import { charactersByRole } from '$lib/sets/queries';
  import { computeScopedSet, parseScopeKey, scopeKeyOf } from '$lib/sets/scope';
  import type { PublishScope } from '$lib/sets/scope';
  import type { AdventureSet } from '$lib/sets/types';
  import { Button, Icon, Select, TextInput } from '$lib/ui';
  import SignInPanel from './SignInPanel.svelte';

  interface Props {
    set: AdventureSet;
  }

  let { set }: Props = $props();

  /**
   * Every row this author has published under this set's `local_id` — the
   * whole set, maybe a villain-side slice, maybe one per hero. Scoped
   * publishing means "is this set published, and as what" is a list rather
   * than a single optional row; `published` below picks the one row the
   * scope selector currently has in view.
   */
  let mine = $state<PublishedSet[]>([]);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let copied = $state(false);
  let size = $state<{ assets: number; bytes: number } | null>(null);
  let changeNote = $state('');
  let draftPreviewUrl = $state('');
  let draftPreviewBusy = $state(false);
  let draftPreviewError = $state<string | null>(null);
  let draftPreviewKind = $state('');
  let draftPreviewRun = 0;
  let draftPreviewSetId = '';

  const heroes = $derived(charactersByRole(set, 'hero'));
  /* Villain-side content — the villain, its minions, the threat track, the
     map, every set-level deck — is one bundle, never split further; see
     `sets/scope.ts`. Offered only when there is something in it to publish. */
  const hasVillainSide = $derived(
    charactersByRole(set, 'villain').length > 0 || charactersByRole(set, 'minion').length > 0
  );

  const scopeOptions = $derived([
    { value: 'full', label: 'Whole set' },
    ...heroes.map((hero) => ({ value: `hero:${hero.id}`, label: characterLabel(hero) })),
    ...(hasVillainSide ? [{ value: 'villain', label: 'Villain side' }] : [])
  ]);

  let selectedScope = $state<PublishScope>({ kind: 'full' });

  /*
   * Falls back to "Whole set" whenever the current selection stops naming a
   * real option — the set just opened (a stale selection from a previous one
   * would otherwise persist), or the hero it named was deleted mid-session.
   */
  $effect(() => {
    const currentSetId = set.id;
    const key = scopeKeyOf(selectedScope);
    if (draftPreviewSetId !== currentSetId) {
      draftPreviewSetId = currentSetId;
      discardDraftPreview();
    }
    if (!scopeOptions.some((option) => option.value === key)) {
      discardDraftPreview();
      selectedScope = { kind: 'full' };
    }
  });

  /** The published row the scope selector currently has in view, if any. */
  const published = $derived(
    mine.find(
      (row) =>
        row.scope === selectedScope.kind &&
        row.character_id === (selectedScope.kind === 'hero' ? selectedScope.characterId : '')
    ) ?? null
  );
  function discardDraftPreview(): void {
    draftPreviewRun += 1;
    if (draftPreviewUrl) URL.revokeObjectURL(draftPreviewUrl);
    draftPreviewUrl = '';
    draftPreviewError = null;
    draftPreviewKind = '';
    draftPreviewBusy = false;
  }

  function chooseScope(key: string): void {
    discardDraftPreview();
    selectedScope = parseScopeKey(key);
  }

  async function refreshDraftPreview(): Promise<void> {
    const run = ++draftPreviewRun;
    draftPreviewBusy = true;
    draftPreviewError = null;
    try {
      const scoped = computeScopedSet(set, selectedScope);
      const image = await renderSocialImage(scoped);
      if (run !== draftPreviewRun) return;
      if (!image) throw new Error('The preview image could not be rendered.');
      if (draftPreviewUrl) URL.revokeObjectURL(draftPreviewUrl);
      draftPreviewUrl = URL.createObjectURL(image);
      const scopedHeroes = charactersByRole(scoped, 'hero');
      draftPreviewKind =
        scoped.kind === 'adventure'
          ? 'Adventures set'
          : scopedHeroes.length === 1
            ? 'Single hero'
            : 'Heroes set';
    } catch (cause) {
      if (run === draftPreviewRun) {
        draftPreviewError =
          cause instanceof Error ? cause.message : 'The preview image could not be rendered.';
      }
    } finally {
      if (run === draftPreviewRun) draftPreviewBusy = false;
    }
  }

  onDestroy(discardDraftPreview);

  /**
   * A throwaway account may share by link but not post to the gallery. The
   * database enforces this; showing it here is so the rule is discovered before
   * someone picks an option and gets an error for it.
   *
   * Listed first because it is the default, and a list whose default is in the
   * middle reads as though something else was expected of you.
   */
  const sharingOptions = $derived(
    [
      ...(auth.isAnonymous
        ? []
        : [{ value: 'public' as const, label: 'Public — visible in the Gallery' }]),
      { value: 'unlisted' as const, label: 'Private link — shared by invitation' }
    ]
  );

  /* Hidden is a state for an existing publication, not a useful way to create
     one. It preserves the row, revision and stable link so the author can put
     it back later, while making it inaccessible to everyone else. */
  const publishedVisibilityOptions = $derived([
    ...sharingOptions,
    { value: 'private' as const, label: 'Hidden — take the published copy offline' }
  ]);

  function visibilityDescription(visibility: Visibility): string {
    if (visibility === 'public') {
      return 'Appears in the public Gallery. Anyone can discover it, open it and share its link.';
    }
    if (visibility === 'unlisted') {
      return 'Does not appear in the Gallery. Only people given the link can find it, though they can pass that link on.';
    }
    return 'Takes the published copy offline without deleting it. Only you can open it until you make it Public or share it by Private link again.';
  }

  /**
   * What a first publish does unless the author says otherwise.
   *
   * Public, because a gallery nobody posts to is not a gallery — the whole
   * point of publishing here is that other people find the set. An anonymous
   * account falls back to a link, because the database refuses a public set
   * from a throwaway identity and sending one would be an error rather than a
   * choice.
   */
  const defaultVisibility = $derived<Visibility>(auth.isAnonymous ? 'unlisted' : 'public');

  /** What the author picked before publishing, if they picked anything. */
  let picked = $state<Visibility | null>(null);

  const wanted = $derived.by<Visibility>(() => {
    const choice = picked ?? defaultVisibility;
    /* Clamped rather than trusted: `picked` survives a sign-out, so someone who
       chose "listed" while signed in and then dropped to an anonymous session
       would otherwise send a value the database is bound to refuse. */
    if (choice === 'private') return defaultVisibility;
    return auth.isAnonymous && choice === 'public' ? 'unlisted' : choice;
  });

  function humanBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Every row this author has published for this set, whatever scope.
   *
   * Matched on `local_id`, which is the set's id in *their* library — the row
   * id belongs to the server. It is what makes re-publishing update the set
   * someone already has a link to, and — now that more than one row can share
   * a `local_id` — what lets a hero's own row and the villain-side row and the
   * full-set row all be found here at once.
   */
  async function refresh(): Promise<void> {
    if (!auth.signedIn) {
      mine = [];
      return;
    }
    try {
      const rows = await listMyPublishedSets();
      mine = rows.filter((row) => row.local_id === set.id);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not check for a published copy.';
    }
  }

  $effect(() => {
    // Re-runs when the open set changes or a session begins.
    void set.id;
    void auth.signedIn;
    void refresh();
  });

  $effect(() => {
    void set.id;
    void selectedScope;
    void publishSize(set, selectedScope).then((value) => (size = value));
  });

  async function guard(action: () => Promise<void>): Promise<void> {
    busy = true;
    error = null;
    try {
      await action();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Something went wrong.';
    } finally {
      busy = false;
    }
  }

  /**
   * Publishing a set that came from somebody else's.
   *
   * Not a block, and deliberately not one: a fork may be a legitimate thing to
   * publish — a variant, a translation, a continuation with permission — and
   * the app is in no position to judge which. What it *is* in a position to do
   * is make sure the question was asked, because the two paths look identical
   * from here and only one of them is what most people mean. Someone who
   * copied a set to fix three cards wants the Contributions panel, and
   * publishing instead puts a near-duplicate of another author's work on the
   * shelf under their own name.
   *
   * Only for a first publish. Re-publishing a fork that is already out there
   * is not the moment to relitigate it.
   */
  let acknowledged = $state(false);
  const needsForkWarning = $derived(set.origin !== null && published === null && !acknowledged);

  const publish = () =>
    guard(async () => {
      status = 'Preparing…';
      const row = await publishSet(set, {
        // Re-publishing keeps whatever the set already is; only a first publish
        // takes the default, because changing visibility is its own control.
        visibility: published?.visibility ?? wanted,
        changeNote,
        scope: selectedScope,
        onProgress: (progress) => {
          status =
            progress.stage === 'assets'
              ? `Uploading artwork ${progress.done} of ${progress.total}…`
              : progress.stage === 'previews'
                ? `Preparing gallery cards ${progress.done} of ${progress.total}…`
                : 'Saving the set…';
        }
      });
      // Replace this scope's row if it already had one, otherwise add it —
      // the other rows in `mine` (other heroes, the villain side) are untouched.
      mine = [...mine.filter((entry) => entry.id !== row.id), row];
      // Cleared on success: a note describes one update, not the set.
      changeNote = '';
      status = 'Published.';
      setTimeout(() => (status = null), 2500);
    });

  const changeVisibility = (value: Visibility) =>
    guard(async () => {
      if (!published) return;
      await setVisibility(published.id, value);
      mine = mine.map((entry) => (entry.id === published.id ? { ...entry, visibility: value } : entry));
    });

  const withdraw = () =>
    guard(async () => {
      if (!published) return;
      await unpublishSet(published.id);
      mine = mine.filter((entry) => entry.id !== published.id);
      status = 'Withdrawn.';
      setTimeout(() => (status = null), 2500);
    });

  async function copyLink(): Promise<void> {
    if (!published) return;
    try {
      await navigator.clipboard.writeText(shareUrl(published.slug));
      copied = true;
      setTimeout(() => (copied = false), 1800);
    } catch {
      // Clipboard access can be refused outright; the field is selectable.
      error = 'Could not copy — select the link and copy it by hand.';
    }
  }
</script>

{#if cloudEnabled()}
  <section class="share">
    <h3 class="title">Share this set</h3>

    <!--
      Previewing is local and useful before sign-in or first publication. The
      same scope then flows into publishing, so what was checked is what leaves.
    -->
    {#if scopeOptions.length > 1}
      <label class="option">
        <span class="option-label">Preview and publish</span>
        <Select
          value={scopeKeyOf(selectedScope)}
          options={scopeOptions}
          disabled={busy}
          onchange={chooseScope}
        />
      </label>
    {/if}

    <section class="social-preview" aria-labelledby="draft-social-preview-title">
      <div class="preview-heading">
        <div>
          <h4 id="draft-social-preview-title">Draft composition</h4>
          <p>Rendered locally from the open draft. Nothing is published or uploaded.</p>
        </div>
        {#if draftPreviewKind}<span class="preview-kind">{draftPreviewKind}</span>{/if}
      </div>

      {#if draftPreviewUrl}
        <div class="preview-media draft-preview-media">
          <img src={draftPreviewUrl} alt="Current draft social preview" />
        </div>
      {:else}
        <div class="preview-empty draft-preview-empty" aria-hidden="true">
          <Icon name="image" size={24} />
          <span>Refresh to render the current composition</span>
        </div>
      {/if}

      <div class="draft-preview-actions">
        <Button
          size="sm"
          disabled={busy || draftPreviewBusy}
          onclick={() => void refreshDraftPreview()}
        >
          {draftPreviewBusy ? 'Rendering…' : 'Refresh preview'}
        </Button>
        {#if draftPreviewError}<p class="error" role="alert">{draftPreviewError}</p>{/if}
      </div>
    </section>

    {#if !auth.signedIn}
      <SignInPanel
        reason="Publishing puts a copy online and gives you a link to hand out. Your set stays in your library either side of it."
        onsignedin={refresh}
      />
    {:else}
      {#if published}
        <p class="line">
          Published as <strong>{published.name}</strong> · revision {published.revision}
          {#if published.published_at}
            · first published {new Date(published.published_at).toLocaleDateString()}
          {/if}
          · updated {new Date(published.updated_at).toLocaleDateString()}
        </p>
        {#if published.change_note}
          <p class="line">Last change: “{published.change_note}”</p>
        {/if}

        <div class="link-row">
          <!-- Readonly rather than static text: it has to be selectable when
               the clipboard is unavailable, which it often is over plain http. -->
          <input class="link" readonly value={shareUrl(published.slug)} />
          <Button size="sm" onclick={copyLink}>{copied ? 'Copied' : 'Copy'}</Button>
        </div>

        <label class="option">
          <span class="option-label">Visibility</span>
          <Select
            value={published.visibility}
            options={publishedVisibilityOptions}
            disabled={busy}
            onchange={(value) => void changeVisibility(value)}
          />
          <span class="visibility-hint">{visibilityDescription(published.visibility)}</span>
        </label>

        <!--
          Offered only once a set is out there. On a first publish there is
          nothing to have changed, and a "what changed" box on an empty history
          is a question with no answer.
        -->
        <label class="option">
          <span class="option-label">What changed? (optional)</span>
          <TextInput
            value={changeNote}
            placeholder="e.g. rebalanced the villain deck"
            maxlength={200}
            oninput={(event) => (changeNote = event.currentTarget.value)}
          />
        </label>

        <div class="actions">
          <Button variant="primary" disabled={busy} onclick={publish}>
            <Icon name="upload" size={13} />
            Update the published copy
          </Button>
          <Button variant="danger" disabled={busy} onclick={withdraw}>Withdraw</Button>
        </div>
      {:else}
        <p class="line">
          Not published yet.
          {#if size && size.assets > 0}
            Publishing will upload {size.assets}
            {size.assets === 1 ? 'image' : 'images'} ({humanBytes(size.bytes)}).
          {/if}
        </p>

        {#if needsForkWarning}
          <div class="caution" role="note">
            <p class="caution-title">This set is a copy of someone else's</p>
            <p class="line">
              It came from
              <strong>{set.origin?.authorName || 'another author'}</strong>’s set. Publishing
              puts your version on the shelf beside theirs, under your name.
            </p>
            <p class="line">
              <strong>If you meant to send these changes back to them</strong>, close this and
              use <em>Offer your changes back</em> above — that is the path that keeps their
              set as the one people find, and lets them take your work into it.
            </p>
            <p class="line">
              Publish separately only when this is genuinely your own thing to share —
              a variant you have permission for, or a set that has grown into
              something of its own. Publishing someone else's work as yours is
              not something the app can detect, and not something it will
              defend you from.
            </p>
            <Button disabled={busy} onclick={() => (acknowledged = true)}>
              I understand — let me publish it separately
            </Button>
          </div>
        {:else}
          <!--
            Offered *before* the first publish, not only after it. The default is
            to list the set in the gallery, and a default that cannot be seen
            until it has already happened is not a choice — it is a surprise.
          -->
          <label class="option">
            <span class="option-label">Visibility</span>
            <Select
              value={wanted}
              options={sharingOptions}
              disabled={busy}
              onchange={(value) => (picked = value)}
            />
            <span class="visibility-hint">{visibilityDescription(wanted)}</span>
          </label>

          <Button variant="primary" disabled={busy} onclick={publish}>
            <Icon name="upload" size={13} />
            {wanted === 'public' ? 'Publish to the Gallery' : 'Publish with a private link'}
          </Button>
        {/if}
      {/if}

      <div class="who">
        <SignInPanel />
      </div>
    {/if}

    {#if status}<p class="status">{status}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>
{/if}

<style>
  .share {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
  }

  .title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .line {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  /* Amber rather than red: this is a question worth stopping at, not a fault. */
  .caution {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid color-mix(in oklab, var(--warning) 45%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--warning) 7%, transparent);
  }

  .caution-title {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--warning);
  }

  .link-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .link {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    color: var(--text-default);
    font-size: var(--text-xs);
    font-family: var(--font-mono, monospace);
  }

  .social-preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-default);
  }

  .preview-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .preview-heading h4,
  .preview-heading p {
    margin: 0;
  }

  .preview-heading h4 {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .preview-heading p {
    margin-top: 2px;
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .preview-kind {
    flex: none;
    padding: 2px var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-full);
    color: var(--text-secondary);
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
  }

  .preview-media {
    display: grid;
    max-height: 320px;
    overflow: hidden;
    place-items: center;
    border-bottom: 1px solid var(--border-default);
    background: var(--surface-default);
  }

  .preview-media img {
    display: block;
    width: 100%;
    max-height: 320px;
    object-fit: contain;
  }

  .draft-preview-media {
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
  }

  .preview-empty {
    display: flex;
    min-height: 132px;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border-bottom: 1px solid var(--border-default);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .draft-preview-empty {
    min-height: 160px;
    border: 1px dashed var(--border-default);
    border-radius: var(--radius-sm);
  }

  .draft-preview-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .option {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .option-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .visibility-hint {
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  /* The account line sits under the controls it qualifies, not above them. */
  .who {
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle, var(--border-default));
  }

  .status {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--danger);
  }

  @media (max-width: 520px) {
    .preview-heading {
      flex-direction: column;
      gap: var(--space-2);
    }

    .preview-media,
    .preview-media img {
      max-height: 240px;
    }
  }
</style>
