<script lang="ts">
  import type { SetSummary } from '$lib/cloud/sets';
  import { Button, TextInput } from '$lib/ui';

  type Target = Pick<SetSummary, 'id' | 'name' | 'revision'>;
  interface Props {
    kind: 'card-images' | 'tts';
    disabled?: boolean;
    lookup: (slug: string) => Promise<Target | null>;
    refresh: (id: string, onProgress: (done: number, total: number) => void) => Promise<boolean>;
    onbusychange: (busy: boolean) => void;
  }

  let { kind, disabled = false, lookup, refresh, onbusychange }: Props = $props();
  const isTts = $derived(kind === 'tts');
  let link = $state('');
  let target = $state<Target | null>(null);
  let lookingUp = $state(false);
  let refreshing = $state(false);
  let done = $state(0);
  let total = $state(0);
  let error = $state<string | null>(null);
  let status = $state('');
  const busy = $derived(lookingUp || refreshing);

  function slugFromLink(): string | null {
    const typed = link.trim();
    if (/^[A-Za-z0-9_-]+$/.test(typed)) return typed;
    try {
      // Only the code is used; pasted hosts never receive a request or token.
      const url = new URL(typed, window.location.origin);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      const path = url.hash.startsWith('#/shared/') ? url.hash.slice(1).split('?')[0] : url.pathname;
      return /\/shared\/([A-Za-z0-9_-]+)\/?$/.exec(path ?? '')?.[1] ?? null;
    } catch {
      return null;
    }
  }

  function changeLink(value: string): void {
    link = value;
    target = null;
    error = null;
    status = '';
  }

  async function find(): Promise<void> {
    if (disabled || busy) return;
    target = null;
    status = '';
    error = null;
    const slug = slugFromLink();
    if (!slug) {
      error = 'Enter a published set’s share link or share code.';
      return;
    }
    lookingUp = true;
    onbusychange(true);
    try {
      target = await lookup(slug);
      if (!target) error = 'No published set was found at that link.';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not look up that published set.';
    } finally {
      lookingUp = false;
      onbusychange(false);
    }
  }

  async function forceRefresh(): Promise<void> {
    if (disabled || busy || !target) return;
    const selected = target;
    refreshing = true;
    error = null;
    status = '';
    done = 0;
    total = 0;
    onbusychange(true);
    try {
      const refreshed = await refresh(selected.id, (completed, count) => {
        done = completed;
        total = count;
      });
      if (!refreshed) throw new Error('That published set is no longer available. Look it up again.');
      status = isTts
        ? `Refreshed the shared TTS copy for ${selected.name}. Export it again and load the new saved object in TTS. Existing objects keep their previous images.`
        : `Refreshed gallery card images for ${selected.name}. Reload its shared page to see them.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : isTts
        ? 'Could not refresh the shared TTS copy.'
        : 'Could not refresh the gallery card images.';
    } finally {
      refreshing = false;
      onbusychange(false);
    }
  }
</script>

<div class="force-refresh">
  <strong>Force refresh one set</strong>
  <p>{isTts
    ? 'Rebuild the shared TTS export, including its card images. Earlier exports keep working while this revision is current. The published content and revision stay the same.'
    : 'Rebuild gallery card images even when they are marked up to date. The published content and revision stay the same.'}</p>
  <label>
    <span>Published set link or code</span>
    <TextInput
      value={link}
      placeholder="https://…/shared/…"
      disabled={disabled || busy}
      oninput={(event) => changeLink(event.currentTarget.value)}
      onkeydown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void find();
        }
      }}
    />
  </label>
  <Button size="sm" variant="ghost" disabled={disabled || busy || !link.trim()} onclick={find}>
    {lookingUp ? 'Looking up…' : 'Look up set'}
  </Button>
  {#if target}
    <div class="target">
      <strong>{target.name}</strong>
      <span>Published revision {target.revision}</span>
    </div>
    <Button size="sm" disabled={disabled || busy} onclick={forceRefresh}>
      {isTts
        ? refreshing ? 'Refreshing TTS copy…' : 'Force refresh TTS copy'
        : refreshing ? 'Refreshing card images…' : 'Force refresh card images'}
    </Button>
  {/if}
  {#if refreshing}
    <p role="status">{total > 0
      ? isTts ? `Preparing ${done} of ${total} TTS items…` : `Rendering ${done} of ${total} card images…`
      : 'Preparing published artwork…'}</p>
    <progress max={total || 1} value={done}></progress>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if status}<p class="success" role="status">{status}</p>{/if}
</div>

<style>
  .force-refresh {
    display: grid;
    gap: var(--space-2);
    width: 100%;
    min-width: 0;
    margin-top: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
  strong { color: var(--text-primary); font-size: var(--text-xs); }
  p { margin: 0; }
  label, .target { display: grid; gap: var(--space-1); min-width: 0; }
  .target { overflow-wrap: anywhere; }
  .error { color: var(--danger); }
  .success { color: var(--success); }
  progress { width: 100%; accent-color: var(--accent); }
</style>
