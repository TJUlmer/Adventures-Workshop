<script lang="ts">
  import type { Rulebook } from '$lib/sets/rulebooks';
  import { saveExport } from '$lib/export';

  let { book }: { book: Rulebook } = $props();
  let localUrl = $state('');
  let downloadError = $state(false);

  async function download(event: MouseEvent): Promise<void> {
    if (book.source.startsWith('data:')) return;
    event.preventDefault();
    downloadError = false;
    try {
      const response = await fetch(book.source);
      if (!response.ok) throw new Error('PDF download failed.');
      saveExport({
        filename: `${book.name.replace(/\.pdf$/i, '') || 'rulebook'}.pdf`,
        mimeType: 'application/pdf',
        blob: await response.blob()
      });
    } catch {
      downloadError = true;
    }
  }

  $effect(() => {
    const source = book.source;
    if (!source.startsWith('data:')) {
      localUrl = '';
      return;
    }

    let active = true;
    let created = '';
    fetch(source)
      .then((response) => response.blob())
      .then((blob) => {
        if (!active) return;
        created = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        localUrl = created;
      })
      .catch(() => { if (active) localUrl = ''; });

    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
      localUrl = '';
    };
  });

  const href = $derived(book.source.startsWith('data:') ? localUrl : book.source);
</script>

{#if href}
  <a href={href} target="_blank" rel="noopener noreferrer">View PDF</a>
  <a href={href} download={`${book.name.replace(/\.pdf$/i, '') || 'rulebook'}.pdf`} onclick={download}>Download</a>
  {#if downloadError}<span>Download failed; use View PDF to save it.</span>{/if}
{:else}
  <span>Preparing PDF…</span>
{/if}

<style>
  a {
    color: var(--text-accent, var(--text-secondary));
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  a:hover {
    color: var(--text-primary);
  }

  span {
    color: var(--text-muted);
  }
</style>
