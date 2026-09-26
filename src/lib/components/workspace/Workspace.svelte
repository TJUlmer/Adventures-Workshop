<script lang="ts">
  /**
   * Routes the centre pane off the current selection. There is exactly one
   * editor per selectable entity, and the union in `Selection` guarantees the
   * cases here are exhaustive.
   *
   * Editors read their subject straight from the store rather than receiving
   * it as a prop: the document is module-owned state, so editing it in place
   * is the intended path, and passing it down would only add a prop boundary
   * to mutate across.
   */
  import { workshop } from '$lib/state/workshop.svelte';
  import CardEditor from './CardEditor.svelte';
  import CharacterEditor from './CharacterEditor.svelte';
  import SetEditor from './SetEditor.svelte';
</script>

<div class="workspace-inner">
  {#if workshop.selectedCard}
    <CardEditor />
  {:else if workshop.selectedCharacter}
    <CharacterEditor />
  {:else}
    <SetEditor />
  {/if}
</div>

<style>
  .workspace-inner {
    container-type: inline-size;
    container-name: workspace;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }

  @media (max-width: 760px), (max-height: 500px) {
    .workspace-inner {
      /* EditorPanes becomes the scroll owner at phone widths and in short
         landscape. Let the complete editor exceed it instead of shrinking
         only the form body beneath permanent header rows. */
      flex: none;
      height: auto;
      min-height: 100%;
    }

    .workspace-inner > :global(.body.scroll-y) {
      flex: 0 0 auto;
      min-height: auto;
      overflow-y: visible;
      overscroll-behavior-y: auto;
    }

    .workspace-inner > :global(.tabs) {
      /* The identity header may scroll away, but switching editor sections
         must remain reachable throughout a long form. */
      position: sticky;
      z-index: var(--z-sticky);
      top: 0;
      background: var(--surface-canvas);
    }
  }
</style>
