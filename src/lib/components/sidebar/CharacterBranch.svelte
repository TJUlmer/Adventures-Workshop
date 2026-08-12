<script lang="ts">
  /**
   * A figure and its decks, foldable.
   *
   * The open state lives here rather than in the store: which branches an
   * author has folded is a view of the tree, not part of the document, and it
   * should not travel with an export or mark the set as changed.
   */
  import type { Snippet } from 'svelte';
  import type { CharacterEntry } from '$lib/sets/types';
  import CharacterRow from './CharacterRow.svelte';

  interface Props {
    entry: CharacterEntry;
    children: Snippet;
  }

  let { entry, children }: Props = $props();

  let open = $state(true);
</script>

<CharacterRow
  character={entry.character}
  printCount={entry.printCount}
  {open}
  ontoggle={() => (open = !open)}
/>

{#if open}
  {@render children()}
{/if}
