<script lang="ts">
  /**
   * "From link" beside an image picker's own Choose button.
   *
   * It only ever produces a `File` and hands it to `onimport` — the same
   * routine that picker already runs for a file chosen from disk — so a linked
   * picture is shrunk, embedded, saved and exported exactly like an uploaded
   * one, and no picker needed a second import path. See `core/image-link.ts`
   * for why the picture is downloaded once rather than kept as a link.
   *
   * The dialog also takes a pasted *image*. A link only works when its host
   * lets other sites download the file, and many do not; an image copied from
   * the page ("Copy image") arrives as bytes and needs no host's permission,
   * which covers "I found a picture somewhere" on any site.
   *
   * A native `<dialog>`, for the reasons `NewSetDialog` sets out.
   */
  import { tick } from 'svelte';
  import {
    acceptMessage,
    downloadImageLink,
    matchesAccept,
    pastedImage,
    resolveImageLink
  } from '$lib/core/image-link';
  import { Button, Icon } from '$lib/ui';

  interface Props {
    /** The picker's own `accept` list, so a link cannot import what a file could not. */
    accept?: string;
    disabled?: boolean;
    /** Square icon button, for pickers laid out too tightly for a label. */
    iconOnly?: boolean;
    size?: 'sm' | 'md';
    /** Match the neighbouring controls: ghost beside a row of bare icons. */
    variant?: 'secondary' | 'ghost';
    /** The picker's existing import routine for a chosen file. */
    onimport: (file: File) => void | Promise<void>;
  }

  let {
    accept,
    disabled = false,
    iconOnly = false,
    size = 'sm',
    variant = 'secondary',
    onimport
  }: Props = $props();

  /* One of these sits beside every picker, several to a page, so the title's
     id must be per instance for `aria-labelledby` to name its own dialog. */
  const uid = $props.id();
  const titleId = `${uid}-title`;

  let dialog = $state<HTMLDialogElement | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  let link = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let controller: AbortController | null = null;

  function open(): void {
    link = '';
    error = null;
    busy = false;
    dialog?.showModal();
  }

  function close(): void {
    controller?.abort();
    controller = null;
    busy = false;
    if (dialog?.open) dialog.close();
  }

  /**
   * Show why an attempt failed, with the link selected to fix or replace. The
   * field is disabled while busy, which drops focus, so this waits for it to
   * be enabled again.
   */
  async function fail(message: string): Promise<void> {
    error = message;
    await tick();
    input?.focus();
    input?.select();
  }

  async function finish(file: File): Promise<void> {
    if (!matchesAccept(accept, file)) {
      void fail(acceptMessage(accept));
      return;
    }
    await onimport(file);
    close();
  }

  async function importLink(event: Event): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const resolved = resolveImageLink(link);
    if (!resolved.ok) {
      void fail(resolved.message);
      return;
    }

    busy = true;
    error = null;
    controller = new AbortController();
    const signal = controller.signal;
    try {
      const file = await downloadImageLink(resolved.url, signal);
      if (signal.aborted) return;
      await finish(file);
    } catch (cause) {
      if (signal.aborted) return;
      void fail(cause instanceof Error ? cause.message : 'Could not import that image.');
    } finally {
      if (!signal.aborted) busy = false;
    }
  }

  async function handlePaste(event: ClipboardEvent): Promise<void> {
    const file = pastedImage(event);
    if (!file || busy) return;
    event.preventDefault();
    busy = true;
    error = null;
    try {
      await finish(file);
    } catch (cause) {
      void fail(cause instanceof Error ? cause.message : 'Could not import that image.');
    } finally {
      busy = false;
    }
  }
</script>

<Button
  {size}
  {variant}
  {iconOnly}
  {disabled}
  title="Import an image from a link, or paste a copied image"
  aria-label={iconOnly ? 'Import an image from a link' : undefined}
  onclick={open}
>
  <Icon name="link" size={13} />
  {#if !iconOnly}From link{/if}
</Button>

<dialog
  bind:this={dialog}
  class="link-dialog ui-dialog-viewport"
  aria-labelledby={titleId}
  onclose={() => close()}
>
  <form class="inner ui-dialog-frame" onsubmit={importLink} onpaste={handlePaste}>
    <div class="body ui-dialog-scroll">
      <header class="head">
        <h2 class="title" id={titleId}>Import an image from a link</h2>
        <p class="lede">
          Paste a link to an image — Imgur links work. Or copy the image itself (right-click or
          long-press it and choose <strong>Copy image</strong>) and paste it here. The picture is
          saved into your set, so it keeps working even if the link stops.
        </p>
      </header>

      <label class="field">
        <span class="field-label">Image link</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:this={input}
          type="text"
          inputmode="url"
          bind:value={link}
          placeholder="https://i.imgur.com/…"
          autocomplete="off"
          spellcheck="false"
          autofocus
          disabled={busy}
        />
      </label>

      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </div>

    <footer class="foot ui-dialog-actions">
      <button type="button" class="cancel" onclick={() => close()}>Cancel</button>
      <button type="submit" class="import" disabled={busy || link.trim().length === 0}>
        {busy ? 'Importing…' : 'Import'}
      </button>
    </footer>
  </form>
</dialog>

<style>
  /* Same reset as `NewSetDialog` — the element's own border, padding and
     max-width are not the app's. */
  .link-dialog {
    --ui-dialog-inline-size: 520px;

    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg, 12px);
    background: var(--surface-raised);
    color: var(--text-default);
  }

  .link-dialog::backdrop {
    background: rgb(0 0 0 / 0.55);
  }

  .inner {
    background: inherit;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6);
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .lede {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed, 1.6);
    color: var(--text-muted);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .field-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
  }

  .field input {
    font: inherit;
    color: var(--text-primary);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
  }

  .field input:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .error {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed, 1.6);
    color: var(--danger);
  }

  .foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--border-subtle);
    background: inherit;
  }

  .cancel,
  .import {
    font: inherit;
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-default);
    background: var(--surface-raised);
    color: var(--text-primary);
    cursor: pointer;
  }

  .import {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--text-on-accent);
  }

  .import:disabled {
    opacity: 0.55;
    cursor: default;
  }

  @media (hover: none), (any-pointer: coarse) {
    .cancel,
    .import {
      min-height: var(--touch-target);
    }
  }
</style>
