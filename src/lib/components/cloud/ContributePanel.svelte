<script lang="ts">
  /**
   * Offering this copy's changes back to the set it came from.
   *
   * Only ever shown on a fork — a set with no `origin` has nowhere to offer
   * anything to. The list is built from the fingerprint recorded when the copy
   * was taken, so it costs nothing to keep up to date and needs no network at
   * all until the moment someone sends it.
   *
   * What is deliberately not here: any sense that offering is *submitting to
   * review*. The owner is under no obligation, the contributor keeps their copy
   * either way, and the wording has to make both obvious or this reads as a
   * queue with a gatekeeper rather than as handing someone your notes.
   */
  import { auth } from '$lib/cloud/auth.svelte';
  import { cloudEnabled } from '$lib/cloud/config';
  import { listMyContributions, offerContribution, withdrawContribution } from '$lib/cloud/contributions';
  import type { ContributionSummary } from '$lib/cloud/contributions';
  import { buildChangeSet } from '$lib/sets/contribution';
  import type { AdventureSet } from '$lib/sets/types';
  import { Button, Icon, TextInput } from '$lib/ui';
  import SignInPanel from './SignInPanel.svelte';

  interface Props {
    set: AdventureSet;
  }

  let { set }: Props = $props();

  let title = $state('');
  let message = $state('');
  let busy = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);
  let mine = $state<ContributionSummary[]>([]);

  /*
   * Recomputed from the document on every edit, which is affordable because
   * hashing a set is the same work the fork already did once and this is not
   * on any hot path — the panel only exists on Set Home.
   */
  const changes = $derived(buildChangeSet(set));

  /** An offer already waiting on this set, if there is one. */
  const pending = $derived(
    mine.find((entry) => entry.set_id === set.origin?.setId && entry.status === 'open') ?? null
  );

  async function refresh(): Promise<void> {
    if (!auth.signedIn || !set.origin) {
      mine = [];
      return;
    }
    try {
      mine = await listMyContributions();
    } catch {
      // A missing history is not worth an error where the offer still works.
      mine = [];
    }
  }

  $effect(() => {
    void set.id;
    void auth.signedIn;
    void refresh();
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

  const offer = () =>
    guard(async () => {
      const origin = set.origin;
      if (!origin) return;
      status = 'Preparing…';
      await offerContribution(origin.setId, set.id, origin.revision, changes, {
        title,
        message,
        onProgress: (done, total) => {
          status = total > 0 ? `Uploading artwork ${done} of ${total}…` : 'Sending…';
        }
      });
      title = '';
      message = '';
      status = 'Sent.';
      await refresh();
      setTimeout(() => (status = null), 2500);
    });

  const withdraw = () =>
    guard(async () => {
      if (!pending) return;
      await withdrawContribution(pending.id);
      await refresh();
    });

  /** Resolved offers, so a contributor can see what became of them. */
  const decided = $derived(
    mine.filter((entry) => entry.set_id === set.origin?.setId && entry.status !== 'open')
  );

  const VERDICT: Record<string, string> = {
    accepted: 'Taken',
    declined: 'Declined',
    withdrawn: 'Withdrawn'
  };
</script>

{#if cloudEnabled() && set.origin}
  <section class="offer">
    <h3 class="title">Offer your changes back</h3>

    {#if !auth.signedIn}
      <SignInPanel
        reason="Offering changes back needs an account, so the author knows who they came from."
        onsignedin={refresh}
      />
    {:else if pending}
      <p class="line">
        You have an offer waiting on this set — {pending.entry_count}
        {pending.entry_count === 1 ? 'change' : 'changes'}, sent
        {new Date(pending.created_at).toLocaleDateString()}.
      </p>
      <p class="line">
        Keep working if you like. Withdraw this one to send an updated offer.
      </p>
      <Button variant="danger" disabled={busy} onclick={withdraw}>Withdraw the offer</Button>
    {:else if changes.length === 0}
      <p class="line">
        Nothing has changed in your copy yet. Edit a card, and what you altered
        shows up here ready to send back.
      </p>
    {:else}
      <p class="line">
        {changes.length}
        {changes.length === 1 ? 'thing' : 'things'} changed since you copied this set at
        revision {set.origin.revision}.
      </p>

      <ul class="changes">
        {#each changes.slice(0, 8) as entry (entry.key)}
          <li class="change">
            <span class="badge" data-change={entry.change}>{entry.change}</span>
            <span class="change-label">{entry.label}</span>
          </li>
        {/each}
        {#if changes.length > 8}
          <li class="more">and {changes.length - 8} more</li>
        {/if}
      </ul>

      <label class="field">
        <span class="field-label">What is this? (optional)</span>
        <TextInput
          value={title}
          placeholder="e.g. rebalanced the villain deck"
          maxlength={120}
          oninput={(event) => (title = event.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span class="field-label">Anything to explain? (optional)</span>
        <textarea
          class="message"
          rows="3"
          maxlength="2000"
          placeholder="Why these changes help."
          bind:value={message}
        ></textarea>
      </label>

      <Button variant="primary" disabled={busy} onclick={offer}>
        <Icon name="upload" size={13} />
        Send to {set.origin.authorName || 'the author'}
      </Button>

      <p class="fineprint">
        They can take all of it, some of it, or none. Your copy stays yours
        whatever they decide.
      </p>
    {/if}

    {#if decided.length > 0}
      <ul class="history">
        {#each decided as entry (entry.id)}
          <li class="past">
            <span class="verdict" data-status={entry.status}>{VERDICT[entry.status]}</span>
            <span class="past-text">
              {entry.title || `${entry.entry_count} changes`}
              {#if entry.status === 'accepted' && entry.applied_keys.length > 0}
                — {entry.applied_keys.length} of {entry.entry_count} taken
              {/if}
              {#if entry.resolution_note}<span class="note">“{entry.resolution_note}”</span>{/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if status}<p class="status">{status}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>
{/if}

<style>
  .offer {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
  }

  .title {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  .line,
  .fineprint,
  .status {
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .fineprint {
    font-size: var(--text-2xs);
  }

  .error {
    font-size: var(--text-xs);
    color: var(--danger);
  }

  .changes,
  .history {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
  }

  .change,
  .past {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .badge,
  .verdict {
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-subtle);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--text-muted);
  }

  .badge[data-change='added'] {
    color: var(--success);
    border-color: color-mix(in oklab, var(--success) 40%, transparent);
  }

  .badge[data-change='removed'] {
    color: var(--danger);
    border-color: color-mix(in oklab, var(--danger) 40%, transparent);
  }

  .verdict[data-status='accepted'] {
    color: var(--success);
    border-color: color-mix(in oklab, var(--success) 40%, transparent);
  }

  .change-label,
  .past-text {
    overflow-wrap: anywhere;
  }

  .more {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .history {
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
  }

  .note {
    color: var(--text-muted);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
  }

  .field-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .message {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    color: var(--text-primary);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
  }
</style>
