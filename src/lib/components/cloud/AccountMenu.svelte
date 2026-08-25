<script lang="ts">
  /**
   * The one place an author's display name can be changed.
   *
   * It exists because of where that name comes from: signing in with Google
   * seeds `profiles.display_name` from the account's real name, at the moment
   * the account is created — see `handle_new_user` in
   * `supabase/migrations/0002_gallery.sql` — and nothing before this asked
   * whether that was the name someone wanted printed under a published set.
   * The trigger only ever runs once, so this is not fighting it on every
   * load; it is the only way to overwrite what it wrote.
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
  import { fetchOwnProfile, updateOwnDisplayName } from '$lib/cloud/profile';
  import { Button, Icon, TextInput } from '$lib/ui';
  import SignInPanel from './SignInPanel.svelte';

  let open = $state(false);
  let host = $state<HTMLDivElement | null>(null);

  let loading = $state(false);
  let displayName = $state('');
  /** What the server currently has, so Save can tell whether there is anything to send. */
  let saved = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);
  let justSaved = $state(false);

  const dirty = $derived(displayName.trim() !== saved);

  /**
   * Loads once per sign-in rather than once per open, so switching accounts —
   * or another tab signing this one out — is reflected without the menu
   * having to be reopened to notice.
   */
  $effect(() => {
    if (!cloudEnabled() || !auth.signedIn) {
      displayName = '';
      saved = '';
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

  async function save(): Promise<void> {
    const next = displayName.trim();
    saving = true;
    error = null;
    try {
      await updateOwnDisplayName(next);
      saved = next;
      displayName = next;
      justSaved = true;
      setTimeout(() => (justSaved = false), 2000);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not save that.';
    } finally {
      saving = false;
    }
  }

  async function signOut(): Promise<void> {
    open = false;
    await auth.signOut();
  }

  /** Close on an outside click or Escape, the way a menu should — see `TitleBar`'s export menu. */
  $effect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (host && !host.contains(event.target as Node)) open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') open = false;
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
      onclick={() => (open = !open)}
    >
      <Icon name="user" size={14} />
    </Button>

    {#if open}
      <div class="menu" role="menu">
        {#if !auth.signedIn}
          <SignInPanel reason="Sign in to publish and share sets from anywhere." />
        {:else}
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
            Shown under any set you publish and on any contribution you offer. A
            Google sign-in starts this as your account's real name — change or
            clear it any time; blank shows as “Anonymous”.
          </p>

          {#if error}<p class="error" role="alert">{error}</p>{/if}

          <div class="row">
            <Button size="sm" variant="primary" disabled={saving || loading || !dirty} onclick={save}>
              {saving ? 'Saving…' : justSaved ? 'Saved' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" onclick={signOut}>Sign out</Button>
          </div>
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
