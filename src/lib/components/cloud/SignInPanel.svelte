<script lang="ts">
  /**
   * Getting far enough into an account to publish something.
   *
   * Three states in one component — choose, code, signed in — because they are
   * one task and splitting them across screens would make signing in feel like
   * a bigger thing than it is. Nothing here is a gate: the app works fully
   * signed out, and this only ever appears beside something an author has
   * chosen to share.
   */
  import { auth } from '$lib/cloud/auth.svelte';
  import { cloudEnabled } from '$lib/cloud/config';
  import { Button, Icon, TextInput } from '$lib/ui';

  interface Props {
    /** Shown above the choices, so the panel can explain why it appeared. */
    reason?: string;
    onsignedin?: () => void;
  }

  let { reason, onsignedin }: Props = $props();

  let email = $state('');
  let code = $state('');
  let error = $state<string | null>(null);

  const stage = $derived(
    auth.signedIn ? 'in' : auth.pendingEmail !== null ? 'code' : 'choose'
  );

  function fail(cause: unknown): void {
    error = cause instanceof Error ? cause.message : 'Something went wrong.';
  }

  async function run(action: () => Promise<void>, done?: () => void): Promise<void> {
    error = null;
    try {
      await action();
      done?.();
    } catch (cause) {
      fail(cause);
    }
  }
</script>

{#if cloudEnabled()}
  <div class="panel">
    {#if reason && stage !== 'in'}
      <p class="reason">{reason}</p>
    {/if}

    {#if stage === 'choose'}
      <!--
        Anonymous first, and larger. It is the path that works right now, it
        asks for nothing, and for someone who wants to hand a friend a link it
        is the whole job. An address is worth collecting only from people who
        want to come back.
      -->
      <Button
        variant="primary"
        block
        disabled={auth.verifying}
        onclick={() => run(() => auth.signInAnonymously(), onsignedin)}
      >
        <Icon name="upload" size={13} />
        {auth.verifying ? 'Setting up…' : 'Share without an account'}
      </Button>
      <p class="fineprint">
        Publishes straight away. The link keeps working, but the ability to
        update or withdraw what you shared lives in <em>this browser</em> — clear
        your site data and you lose it. Your set itself is never at risk; it
        stays in your library either way.
      </p>

      {#if auth.providers.length > 0}
        <div class="or"><span>or</span></div>
      {/if}

      <!--
        The account that can publish to the gallery. A throwaway one cannot —
        the database refuses it — so this is the only route to a listed set, and
        it is also the only one that produces a name to put under it.
      -->
      {#each auth.providers as provider (provider.id)}
        <Button block onclick={() => auth.signInWithProvider(provider.id)}>
          Continue with {provider.label}
        </Button>
      {/each}
      {#if auth.providers.length > 0}
        <p class="fineprint">
          Gives you a private online draft library across browsers and publishes under the name
          that account already has. Leaves this page and comes straight back.
        </p>
      {/if}

      <div class="or"><span>or</span></div>

      <form
        class="row"
        onsubmit={(event) => {
          event.preventDefault();
          void run(() => auth.requestCode(email));
        }}
      >
        <TextInput bind:value={email} placeholder="you@example.com" inputmode="email" autocomplete="email" />
        <Button type="submit" disabled={auth.sending || email.trim().length === 0}>
          {auth.sending ? 'Sending…' : 'Email me a code'}
        </Button>
      </form>
      <p class="fineprint">Keeps private drafts across browsers and devices.</p>
    {:else if stage === 'code'}
      <p class="sent">
        A six-digit code is on its way to <strong>{auth.pendingEmail}</strong>.
      </p>

      <form
        class="row"
        onsubmit={(event) => {
          event.preventDefault();
          void run(() => auth.verifyCode(code), onsignedin);
        }}
      >
        <!--
          `inputmode` and `autocomplete` are what let a phone offer the code
          from the notification instead of making someone memorise six digits
          and switch apps.
        -->
        <TextInput
          bind:value={code}
          placeholder="123456"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength={6}
        />
        <Button type="submit" variant="primary" disabled={auth.verifying || code.trim().length < 6}>
          {auth.verifying ? 'Checking…' : 'Sign in'}
        </Button>
      </form>

      <button class="link" type="button" onclick={() => (auth.pendingEmail = null)}>
        Use a different address
      </button>
    {:else}
      <div class="who">
        <span class="status">
          {#if auth.isAnonymous}
            Sharing anonymously, from this browser.
          {:else}
            Signed in as <strong>{auth.user?.email}</strong>.
          {/if}
        </span>
        <Button size="sm" variant="ghost" onclick={() => void auth.signOut()}>Sign out</Button>
      </div>

      {#if auth.isAnonymous}
        <p class="fineprint">
          An ownership-preserving upgrade is not available yet. Ordinary Google sign-in would be
          a different account, so this screen does not present it as an upgrade or move anything
          you already published.
        </p>
      {/if}
    {/if}

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
  </div>
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .row :global(input) {
    flex: 1;
    min-width: 0;
  }

  .reason,
  .sent {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-default);
  }

  .fineprint {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--danger);
  }

  /* A rule with the word sitting in it, so the two paths read as alternatives
     rather than as steps. */
  .or {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .or::before,
  .or::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border-default);
  }

  .who {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .status {
    font-size: var(--text-sm);
  }

  .link {
    align-self: flex-start;
    padding: 0;
    background: none;
    border: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-decoration: underline;
    cursor: pointer;
  }

  .link:hover {
    color: var(--text-default);
  }

</style>
