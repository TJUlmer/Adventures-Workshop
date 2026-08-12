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
</style>
