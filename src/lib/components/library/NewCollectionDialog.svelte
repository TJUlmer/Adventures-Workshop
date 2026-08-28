<script lang="ts">
  /**
   * "What is a collection?" — asked before one exists, not after.
   *
   * This started as a bare button that created a collection on the first
   * click, on the reasoning that a *set* has to choose a kind up front while a
   * collection has nothing to decide. That reasoning was about decisions and
   * missed the more basic problem: nobody knows what a collection **is**.
   * "New collection" sitting beside "New set" reads like a second kind of set,
   * so the first click is as likely to be somebody finding out as somebody
   * meaning it — and it left a real row behind either way.
   *
   * So the dialog is not here to collect a decision. It is here to explain the
   * noun, and to make creating one deliberate. The name field earns its place
   * on the same grounds: typing a project's name is the cheapest possible
   * proof that somebody meant to start a project.
   *
   * A native `<dialog>`, for the reasons `NewSetDialog` sets out — focus
   * trapping, Escape, the top layer and an inert background, none of which
   * this app has a dependency to reimplement.
   */
  import { Icon } from '$lib/ui';

  interface Props {
    open: boolean;
    busy: boolean;
    oncreate: (name: string) => void;
    oncancel: () => void;
  }

  let { open, busy, oncreate, oncancel }: Props = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let name = $state('');

  /* Driven from the prop, like `NewSetDialog`, so the element and the flag
     cannot disagree about whether it is showing. Cleared on open rather than
     on close, so a cancelled draft is not still sitting there next time. */
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      name = '';
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  });

  function submit(event: Event): void {
    event.preventDefault();
    if (busy) return;
    oncreate(name.trim());
  }
</script>

<dialog
  bind:this={dialog}
  class="chooser"
  aria-labelledby="new-collection-title"
  onclose={() => oncancel()}
>
  <form class="inner" onsubmit={submit}>
    <header class="head">
      <h2 class="title" id="new-collection-title">Start a collection</h2>
      <p class="lede">
        A collection gathers decks that <strong>other people</strong> own into one themed box
        with one link — the shape a community jam takes, where several creators each build a
        deck to a shared theme.
      </p>
    </header>

    <ul class="points">
      <li>
        <Icon name="users" size={15} />
        <span>
          Every deck stays owned by whoever made it. They keep editing and publishing it; a
          collection only points at it.
        </span>
      </li>
      <li>
        <Icon name="card" size={15} />
        <span>
          Decks join by invitation or by offering themselves, and the other side always
          decides. Nothing is added to your collection without its author agreeing.
        </span>
      </li>
      <li>
        <Icon name="eye" size={15} />
        <span>
          It starts unlisted — reachable only by its link, so a project can be built in
          private and shown off when it is ready.
        </span>
      </li>
    </ul>

    <!--
      Said plainly, because the alternative is somebody making a collection when
      they wanted a set and only finding out several screens later.
    -->
    <p class="not">
      If you are building your own cards, you want <strong>New set</strong> instead. A
      collection holds no cards of its own.
    </p>

    <label class="field">
      <span class="field-label">What is it called?</span>
      <input
        type="text"
        bind:value={name}
        placeholder="Winter Extravaganza"
        maxlength="80"
        autocomplete="off"
      />
    </label>

    <footer class="foot">
      <button type="button" class="cancel" onclick={() => oncancel()}>Cancel</button>
      <button type="submit" class="create" disabled={busy || name.trim().length === 0}>
        {busy ? 'Creating…' : 'Create collection'}
      </button>
    </footer>
  </form>
</dialog>

<style>
  /* Same reset as `NewSetDialog` — the element's own border, padding and
     max-width are not the app's. */
  .chooser {
    padding: 0;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg, 12px);
    background: var(--surface-raised);
    color: var(--text-default);
    max-width: min(560px, calc(100vw - var(--space-6) * 2));
  }

  .chooser::backdrop {
    background: rgb(0 0 0 / 0.55);
  }

  .inner {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
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

  .points {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .points li {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-3);
    align-items: start;
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed, 1.6);
    color: var(--text-secondary);
  }

  .points :global(svg) {
    margin-top: 0.15em;
    color: var(--text-accent);
  }

  .not {
    margin: 0;
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed, 1.6);
    color: var(--text-secondary);
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

  .foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .cancel,
  .create {
    font: inherit;
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-default);
    background: var(--surface-raised);
    color: var(--text-primary);
    cursor: pointer;
  }

  .create {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--text-on-accent);
  }

  .create:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .cancel:focus-visible,
  .create:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
