<script lang="ts">
  /**
   * The card and character workspace: hierarchy on the left, the editor in the
   * middle, the live card on the right.
   *
   * This used to be the whole application; it is now one page of a set. The
   * three-pane arrangement is exactly what it was, because for the work it does
   * — picking a card, editing it, watching it change — it was right.
   */
  import type { Snippet } from 'svelte';

  interface Props {
    sidebar: Snippet;
    workspace: Snippet;
    preview: Snippet;
  }

  let { sidebar, workspace, preview }: Props = $props();
</script>

<div class="panes">
  <aside class="sidebar" aria-label="Set contents">{@render sidebar()}</aside>
  <main class="workspace" aria-label="Editor">{@render workspace()}</main>
  <aside class="preview" aria-label="Card preview">{@render preview()}</aside>
</div>

<style>
  .panes {
    display: grid;
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr) var(--preview-width);
    flex: 1 1 auto;
    min-height: 0;
  }

  .sidebar,
  .preview,
  .workspace {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .sidebar {
    background: var(--surface-sunken);
    border-right: 1px solid var(--border-subtle);
  }

  .workspace {
    background: var(--surface-canvas);
  }

  .preview {
    background: var(--surface-sunken);
    border-left: 1px solid var(--border-subtle);
  }

  /* Below this width the preview pane stops earning its keep. */
  @media (max-width: 1180px) {
    .panes {
      grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
    }

    .preview {
      display: none;
    }
  }
</style>
