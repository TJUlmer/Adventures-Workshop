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
  import { readStorageEstimate } from '$lib/storage/indexeddb';
  import type { StorageEstimate } from '$lib/storage/indexeddb';
  import AccountMenu from '$lib/components/cloud/AccountMenu.svelte';
  import { Icon, ThemeToggle } from '$lib/ui';

  let storage = $state<StorageEstimate | null>(null);

  /** Refresh after navigation and durable writes so this remains useful all session. */
  $effect(() => {
    navigation.view;
    workshop.savedAt;
    void readStorageEstimate().then((value) => (storage = value));
  });

  const homeActive = $derived(navigation.view.kind === 'home');
  const galleryActive = $derived(
    navigation.view.kind === 'gallery' ||
      navigation.view.kind === 'shared' ||
      navigation.view.kind === 'author'
  );

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
    await workshop.closeSet();
    if (sharedPathOpen) navigation.leaveShared({ kind: 'home' });
  }

  function openGallery(): void {
    if (readSharedSlug() !== null) navigation.leaveShared({ kind: 'gallery' });
    else navigation.openGallery();
  }
</script>

<div class="bar">
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

  <nav class="navigation" aria-label="Application">
    <button
      type="button"
      class="nav-link"
      class:active={homeActive}
      aria-current={homeActive ? 'page' : undefined}
      onclick={goHome}
    >
      <Icon name="grid" size={14} />
      Home
    </button>
    <button
      type="button"
      class="nav-link"
      class:active={galleryActive}
      aria-current={galleryActive ? 'page' : undefined}
      onclick={openGallery}
    >
      <Icon name="layers" size={14} />
      Browse Gallery
    </button>
    <ThemeToggle />
    <AccountMenu />
  </nav>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    height: 100%;
    padding-inline: var(--space-5);
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

  @media (max-width: 760px) {
    .bar {
      gap: var(--space-3);
      padding-inline: var(--space-3);
    }

    .tagline,
    .storage {
      display: none;
    }

    .mark {
      width: 34px;
      height: 34px;
    }

    .nav-link {
      padding-inline: var(--space-2);
      font-size: var(--text-xs);
    }
  }
</style>
