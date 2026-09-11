<script lang="ts">
  /**
   * The one place an author's display name can be changed.
   *
   * A new account starts with the part of its email before `@`, rather than a
   * real name copied from OAuth. This remains the place to choose something
   * else, or nothing at all, before that name is printed under public work.
   *
   * Also the one entry point into signing in that is not tied to sharing or
   * contributing — findable from the corner at any time, not only at the
   * moment of publishing, since an author sitting down to build a set has no
   * other reason yet to land on `SharePanel` or `ContributePanel`. Signed
   * out, it renders `SignInPanel` in place of the profile form; signed in,
   * it is the display-name editor described above.
   */
  import { auth } from '$lib/cloud/auth.svelte';
  import { cloudEnabled } from '$lib/cloud/config';
  import { saveExport } from '$lib/export';
  import { draftDiagnostics } from '$lib/persistence/diagnostics.svelte';
  import { draftRollout } from '$lib/persistence/rollout.svelte';
  import { fetchOwnProfile, updateOwnDisplayName } from '$lib/cloud/profile';
  import {
    listOutdatedSocialPreviews,
    refreshPublishedSocialPreview
  } from '$lib/cloud/sets';
  import type { SocialPreviewRefreshTarget } from '$lib/cloud/sets';
  import { Button, Icon, TextInput } from '$lib/ui';
  import SignInPanel from './SignInPanel.svelte';

  interface Props {
    /** A completed provider redirect should put the public-name choice in view. */
    openOnStart?: boolean;
  }

  let { openOnStart = false }: Props = $props();
  let open = $state(false);
  let showNameReview = $state(false);
  let appliedOpenOnStart = $state(false);
  let host = $state<HTMLDivElement | null>(null);

  let loading = $state(false);
  let displayName = $state('');
  /** What the server currently has, so Save can tell whether there is anything to send. */
  let saved = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);
  let justSaved = $state(false);
  let isAdmin = $state(false);
  let previewQueue = $state<SocialPreviewRefreshTarget[]>([]);
  let previewQueueLoading = $state(false);
  let previewRefreshing = $state(false);
  let previewCompleted = $state(0);
  let previewTotal = $state(0);
  let previewCurrent = $state('');
  let previewFailures = $state<string[]>([]);
  let previewError = $state<string | null>(null);

  const dirty = $derived(displayName.trim() !== saved);

  $effect(() => {
    if (!openOnStart || appliedOpenOnStart) return;
    appliedOpenOnStart = true;
    open = true;
    showNameReview = true;
  });

  /**
   * Loads once per sign-in rather than once per open, so switching accounts —
   * or another tab signing this one out — is reflected without the menu
   * having to be reopened to notice.
   */
  $effect(() => {
    if (!cloudEnabled() || !auth.signedIn) {
      displayName = '';
      saved = '';
      isAdmin = false;
      previewQueue = [];
      return;
    }

    let cancelled = false;
    loading = true;
    error = null;
    void fetchOwnProfile()
      .then((profile) => {
        if (cancelled || !profile) return;
        displayName = profile.displayName;
        saved = profile.displayName;
        isAdmin = profile.isAdmin;
        if (profile.isAdmin) void loadPreviewQueue();
      })
      .catch((cause) => {
        if (!cancelled) error = cause instanceof Error ? cause.message : 'Could not load your profile.';
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });

    return () => {
      cancelled = true;
    };
  });

  async function loadPreviewQueue(): Promise<void> {
    previewQueueLoading = true;
    previewError = null;
    try {
      previewQueue = await listOutdatedSocialPreviews();
    } catch (cause) {
      previewError =
        cause instanceof Error ? cause.message : 'Could not check the social-preview queue.';
    } finally {
      previewQueueLoading = false;
    }
  }

  async function refreshSocialPreviews(): Promise<void> {
    if (previewRefreshing || previewQueue.length === 0) return;

    const queue = [...previewQueue];
    previewRefreshing = true;
    previewCompleted = 0;
    previewTotal = queue.length;
    previewFailures = [];
    previewError = null;

    for (const target of queue) {
      previewCurrent = target.name;
      try {
        await refreshPublishedSocialPreview(target.id);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Unknown error';
        previewFailures = [...previewFailures, `${target.name}: ${message}`];
      } finally {
        previewCompleted += 1;
      }
    }

    previewCurrent = '';
    previewRefreshing = false;
    await loadPreviewQueue();
  }

  async function save(): Promise<void> {
    const next = displayName.trim();
    saving = true;
    error = null;
    try {
      await updateOwnDisplayName(next);
      saved = next;
      displayName = next;
      justSaved = true;
      showNameReview = false;
      setTimeout(() => (justSaved = false), 2000);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not save that.';
    } finally {
      saving = false;
    }
  }

  async function signOut(): Promise<void> {
    open = false;
    showNameReview = false;
    await auth.signOut();
  }

  async function toggleDraftPreview(): Promise<void> {
    await draftRollout.setEnabled(!draftRollout.enabled);
  }

  function downloadDiagnostics(): void {
    saveExport(draftDiagnostics.export());
  }

  /** Close on an outside click or Escape, the way a menu should — see `TitleBar`'s export menu. */
  $effect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (host && !host.contains(event.target as Node)) {
        open = false;
        showNameReview = false;
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        open = false;
        showNameReview = false;
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

{#if cloudEnabled()}
  <div class="account" bind:this={host}>
    <Button
      size="sm"
      variant="ghost"
      iconOnly
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label="Account"
      title={auth.signedIn ? (auth.isAnonymous ? 'Sharing anonymously' : auth.user?.email) : 'Sign in'}
      onclick={() => {
        open = !open;
        if (!open) showNameReview = false;
      }}
    >
      <Icon name="user" size={14} />
    </Button>

    {#if open}
      <div class="menu" role="menu">
        {#if !auth.signedIn}
          <SignInPanel
            reason={draftRollout.mode === 'off'
              ? 'Sign in to manage what you publish.'
              : 'Sign in to try private drafts across browsers and publish when you choose.'}
          />
        {:else}
          {#if showNameReview && !auth.isAnonymous}
            <p class="name-review">
              Choose the display name shown publicly with your sets and contributions.
            </p>
          {/if}

          <p class="who">
            {#if auth.isAnonymous}
              Sharing anonymously, from this browser.
            {:else}
              Signed in as <strong>{auth.user?.email}</strong>
            {/if}
          </p>

          <label class="field">
            <span class="field-label">Display name</span>
            <TextInput
              bind:value={displayName}
              placeholder={loading ? 'Loading…' : 'Shown under anything you publish'}
              disabled={loading}
            />
          </label>
          <p class="fineprint">
            Shown under any set you publish and on any contribution you offer. New
            accounts start with the part of their email before @. Change or clear
            it any time; blank shows as “Anonymous”.
          </p>

          {#if !auth.isAnonymous}
            <section class="draft-rollout" data-enabled={draftRollout.enabled}>
              <div>
                <strong>{draftRollout.mode === 'opt-in' ? 'Cloud drafts beta' : 'Cloud drafts'}</strong>
                {#if draftRollout.mode === 'off'}
                  <small>Off in this build. Drafts stay on this device; publishing still works.</small>
                {:else if !draftRollout.preferenceLoaded}
                  <small>Checking this browser’s cloud-draft choice…</small>
                {:else if draftRollout.enabled}
                  <small>
                    {draftRollout.preference === true
                      ? 'On for this browser by your choice. Turning it off keeps online drafts intact and uses downloaded device copies.'
                      : draftRollout.mode === 'cohort'
                        ? 'Automatically enabled for this account’s limited rollout group. You can still use device copies on this browser.'
                        : 'Automatically enabled for permanent accounts. You can still use device copies on this browser.'}
                  </small>
                {:else if draftRollout.preference === false}
                  <small>Off on this browser by your choice. Online drafts remain intact.</small>
                {:else}
                  <small>
                    This account is not automatically enrolled yet. You can still turn on cloud drafts for this browser.
                  </small>
                {/if}
              </div>
              {#if draftRollout.canChoose}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={draftRollout.saving}
                  onclick={toggleDraftPreview}
                >
                  {draftRollout.saving
                    ? 'Saving…'
                    : draftRollout.enabled
                      ? 'Use device copies'
                      : 'Try cloud drafts'}
                </Button>
              {/if}
              {#if draftRollout.error}<p class="error" role="alert">{draftRollout.error}</p>{/if}
            </section>

          {/if}

          {#if isAdmin}
            <section class="preview-maintenance">
              <div>
                <strong>Social preview styles</strong>
                {#if previewQueueLoading && !previewRefreshing}
                  <small>Checking published previews…</small>
                {:else if previewRefreshing}
                  <small>
                    Refreshing {Math.min(previewCompleted + 1, previewTotal)} of {previewTotal}:
                    {previewCurrent}
                  </small>
                {:else if previewQueue.length > 0}
                  <small>
                    {previewQueue.length} published
                    {previewQueue.length === 1 ? 'preview uses' : 'previews use'} an older composition.
                  </small>
                {:else}
                  <small>Every published preview uses the current composition.</small>
                {/if}
              </div>

              {#if previewRefreshing}
                <progress max={previewTotal} value={previewCompleted}>
                  {previewCompleted} of {previewTotal}
                </progress>
              {:else}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={previewQueueLoading || previewQueue.length === 0}
                  onclick={refreshSocialPreviews}
                >
                  Refresh outdated previews
                </Button>
              {/if}

              {#if previewFailures.length > 0}
                <small class="preview-failures">
                  {previewFailures.length} failed and remain in the queue. {previewFailures[0]}
                </small>
              {/if}
              {#if previewError}<p class="error" role="alert">{previewError}</p>{/if}
            </section>
          {/if}

          {#if error}<p class="error" role="alert">{error}</p>{/if}

          <div class="row">
            <Button size="sm" variant="primary" disabled={saving || loading || !dirty} onclick={save}>
              {saving ? 'Saving…' : justSaved ? 'Saved' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" onclick={signOut}>Sign out</Button>
          </div>
        {/if}

        {#if draftDiagnostics.entries.length > 0}
          <section class="support-report">
            <div>
              <strong>Cloud save support report</strong>
              <small>
                Contains the latest {draftDiagnostics.entries.length} save-stage timings and
                status codes—never set contents, account details, or sign-in tokens.
              </small>
            </div>
            <Button size="sm" variant="ghost" onclick={downloadDiagnostics}>Download report</Button>
          </section>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .account {
    position: relative;
  }

  .menu {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: 0;
    z-index: var(--z-dropdown);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 300px;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-overlay);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
  }

  .who {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .name-review {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in oklab, var(--accent) 44%, var(--border-default));
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--accent) 10%, var(--surface-sunken));
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-primary);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-label {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .fineprint {
    margin: 0;
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .draft-rollout,
  .preview-maintenance,
  .support-report {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
  }

  .draft-rollout[data-enabled='true'] {
    border-color: color-mix(in oklab, var(--success) 40%, var(--border-subtle));
  }

  .draft-rollout strong,
  .draft-rollout small,
  .preview-maintenance strong,
  .preview-maintenance small,
  .support-report strong,
  .support-report small {
    display: block;
  }

  .draft-rollout strong,
  .preview-maintenance strong,
  .support-report strong {
    font-size: var(--text-xs);
    color: var(--text-primary);
  }

  .draft-rollout small,
  .preview-maintenance small,
  .support-report small {
    margin-top: var(--space-1);
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .preview-maintenance progress {
    width: 100%;
    accent-color: var(--accent);
  }

  .preview-failures {
    color: var(--danger) !important;
  }

  .error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--danger);
  }

  .row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }
</style>
