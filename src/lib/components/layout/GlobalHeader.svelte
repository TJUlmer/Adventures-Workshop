<script lang="ts">
  /**
   * Application navigation that does not move when the view changes.
   *
   * Screen-specific headers used to each recreate some combination of the
   * brand, Home, Gallery, theme and account controls. Besides changing their
   * order and wording, that made shared sets and creator profiles feel like a
   * different application. This banner is mounted once by `App.svelte`; pages
   * beneath it own only the actions that operate on their current subject.
   */
  import { readSharedSlug } from '$lib/state/navigation.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { workshop } from '$lib/state/workshop.svelte';
  import { coverArtwork } from '$lib/cloud/thumbnail';
  import { readStorageEstimate } from '$lib/storage/indexeddb';
  import type { StorageEstimate } from '$lib/storage/indexeddb';
  import { loadSet } from '$lib/storage/library';
  import AccountMenu from '$lib/components/cloud/AccountMenu.svelte';
  import { Icon, ThemeToggle } from '$lib/ui';

  let storage = $state<StorageEstimate | null>(null);
  let continueCover = $state<string | null>(null);
  let coverRequest = 0;

  /** Refresh after navigation and durable writes so this remains useful all session. */
  $effect(() => {
    navigation.view;
    workshop.savedAt;
    void readStorageEstimate().then((value) => (storage = value));
  });

  /* An empty library's Home renders Welcome, so only one destination should
     announce itself as current in that first-run state. */
  const homeActive = $derived(
    navigation.view.kind === 'home' && workshop.library.length > 0
  );
  const welcomeActive = $derived(
    navigation.view.kind === 'welcome' ||
      (navigation.view.kind === 'home' && workshop.library.length === 0)
  );
  const latestSet = $derived(workshop.library[0] ?? null);
  const galleryActive = $derived(
    navigation.view.kind === 'gallery' ||
      navigation.view.kind === 'shared' ||
      navigation.view.kind === 'author'
  );

  /* The index deliberately carries no artwork. Resolve only the newest set,
     and repeat after a save in case its cover changed while it was open. */
  $effect(() => {
    const entry = latestSet;
    workshop.savedAt;
    const request = ++coverRequest;
    continueCover = null;
    if (!entry) return;

    void loadSet(entry.id).then((set) => {
      if (request !== coverRequest) return;
      continueCover = set ? (coverArtwork(set)?.source ?? null) : null;
    });
  });

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  async function goHome(): Promise<void> {
    /* `closeSet` refreshes the library and clears last-open state. A shared
       path also needs `leaveShared` or its URL would reopen itself on reload. */
    const sharedPathOpen = readSharedSlug() !== null;
    if (navigation.inSet && !(await workshop.saveNow())) return;
    await workshop.closeSet();
    if (sharedPathOpen) navigation.leaveShared({ kind: 'home' });
  }

  async function openWelcome(): Promise<void> {
    /* Leaving the editor cancels its pending autosave timer. Flush first so
       Continue cannot immediately reload an older stored copy. */
    if (navigation.inSet && !(await workshop.saveNow())) return;
    if (readSharedSlug() !== null) navigation.leaveShared({ kind: 'welcome' });
    else navigation.openWelcome();
  }

  async function continueWorking(): Promise<void> {
    const entry = latestSet;
    if (!entry) return;

    /* Already here: navigate without reloading the saved document over the
       live one, which may be inside the autosave debounce window. */
    if (navigation.inSet && workshop.adventure.id === entry.id) {
      navigation.go('home');
      return;
    }

    if (navigation.inSet && !(await workshop.saveNow())) return;
    if (readSharedSlug() !== null) navigation.leaveShared({ kind: 'home' });
    await workshop.openSet(entry.id);
  }

  async function openGallery(): Promise<void> {
    if (navigation.inSet && !(await workshop.saveNow())) return;
    if (readSharedSlug() !== null) navigation.leaveShared({ kind: 'gallery' });
    else navigation.openGallery();
  }
</script>

<div class="bar">
  <div class="left-navigation">
    <button class="brand" type="button" onclick={goHome} title="Home">
      <img class="mark" src="/assets/labs_beaker5.png" alt="" aria-hidden="true" />
      <span class="identity">
        <span class="wordmark">Unmatched Labs</span>
        <span class="tagline">The unmatched toolkit for Unmatched creation</span>
        {#if storage}
          <span class="storage numeric">
            {formatSize(storage.usageBytes)} of {formatSize(storage.quotaBytes)} used
          </span>
        {/if}
      </span>
    </button>

    <button
      type="button"
      class="nav-link welcome-link"
      class:active={welcomeActive}
      aria-current={welcomeActive ? 'page' : undefined}
      onclick={openWelcome}
    >
      <Icon name="sparkle" size={14} />
      Welcome
    </button>
  </div>

  {#if latestSet}
    <button
      type="button"
      class="continue-link"
      onclick={continueWorking}
      title="Continue working on {latestSet.name || 'Untitled Adventure'}"
      aria-label="Continue working on {latestSet.name || 'Untitled Adventure'}"
    >
      <span class="continue-thumb" aria-hidden="true">
        {#if continueCover}
          <img src={continueCover} alt="" />
        {:else}
          <span>{(latestSet.name || 'U').trim().charAt(0).toUpperCase()}</span>
        {/if}
      </span>
      <span>Continue working</span>
      <Icon name="chevronRight" size={13} />
    </button>
  {:else}
    <span class="continue-placeholder" aria-hidden="true"></span>
  {/if}

  <nav class="navigation" aria-label="Application">
    <button
      type="button"
      class="nav-link"
      class:active={homeActive}
      aria-current={homeActive ? 'page' : undefined}
      onclick={goHome}
    >
      <Icon name="grid" size={14} />
      <span class="nav-label">Home</span>
    </button>
    <button
      type="button"
      class="nav-link"
      class:active={galleryActive}
      aria-current={galleryActive ? 'page' : undefined}
      onclick={openGallery}
    >
      <Icon name="layers" size={14} />
      <span class="nav-label">Browse Gallery</span>
    </button>
    <ThemeToggle />
    <AccountMenu />
  </nav>
</div>

<style>
  .bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-6);
    height: 100%;
    padding-inline: var(--space-5);
  }

  .left-navigation {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    justify-self: start;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    padding: 0;
    color: inherit;
    text-align: left;
  }

  .mark {
    width: 45px;
    height: 45px;
    flex: none;
    object-fit: contain;
  }

  .identity {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: var(--leading-tight);
  }

  .wordmark {
    font-family: var(--font-display);
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .tagline {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .storage {
    margin-top: 1px;
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
    white-space: nowrap;
  }

  .navigation {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    flex: none;
    justify-self: end;
  }

  .continue-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 36px;
    padding: 3px var(--space-3) 3px 4px;
    border: 1px solid color-mix(in oklab, var(--accent) 24%, var(--border-default));
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--surface-raised) 88%, var(--accent) 12%);
    box-shadow: var(--shadow-sm);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
    white-space: nowrap;
    transition:
      border-color var(--duration-fast) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .continue-link:hover {
    border-color: color-mix(in oklab, var(--accent) 44%, var(--border-default));
    background: color-mix(in oklab, var(--surface-hover) 84%, var(--accent) 16%);
    color: var(--text-primary);
  }

  .continue-thumb {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: var(--radius-full);
    overflow: hidden;
    background: var(--surface-sunken);
    box-shadow: inset 0 0 0 1px var(--border-subtle);
    font-family: var(--font-display);
    font-size: var(--text-xs);
    color: var(--accent);
  }

  .continue-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .continue-placeholder {
    width: 1px;
    height: 1px;
  }

  .nav-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 30px;
    padding-inline: var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-tight);
    color: var(--text-tertiary);
    white-space: nowrap;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .nav-link:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .nav-link.active {
    background: var(--surface-active);
    color: var(--text-primary);
    box-shadow: inset 0 0 0 1px var(--border-default);
  }

  @media (max-width: 1050px) {
    .tagline,
    .storage {
      display: none;
    }

    .bar {
      gap: var(--space-3);
    }

    .left-navigation {
      gap: var(--space-2);
    }
  }

  @media (max-width: 760px) {
    .bar {
      gap: var(--space-3);
      padding-inline: var(--space-3);
    }

    .mark {
      width: 34px;
      height: 34px;
    }

    .nav-link {
      padding-inline: var(--space-2);
      font-size: var(--text-xs);
    }

    .continue-link {
      padding-right: var(--space-2);
    }
  }

  @media (max-width: 620px) {
    .wordmark,
    .nav-label,
    .welcome-link :global(svg),
    .continue-link > :global(svg) {
      display: none;
    }

    .continue-link {
      padding-right: var(--space-3);
    }
  }
</style>
