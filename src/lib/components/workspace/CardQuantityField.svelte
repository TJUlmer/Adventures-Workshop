<script lang="ts">
  import { physicalCopies } from '$lib/cards/copy-visuals';
  import CardRenderer from '$lib/renderer/CardRenderer.svelte';
  import { characterForCard, resolveStyleForCard } from '$lib/sets/queries';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Button, Field, NumberInput } from '$lib/ui';
  const card = $derived(workshop.selectedCard);
  let requested = $state<number | null>(null);
  let keep = $state<Set<number>>(new Set());
  let dialog = $state<HTMLDialogElement | null>(null);
  let requestCard = $state('');
  $effect(() => {
    const request = workshop.copyQuantityRequest;
    if (!request || request.cardId !== card?.id) return;
    requestCard = request.cardId;
    requested = request.quantity;
    keep = new Set(Array.from({ length: request.quantity }, (_, i) => i + 1));
    workshop.copyQuantityRequest = null;
  });
  $effect(() => {
    if (requested !== null && card?.id === requestCard) {
      if (dialog && !dialog.open) dialog.showModal();
    } else {
      dialog?.close();
      if (requested !== null) requested = null;
    }
  });
  function change(quantity:number) {
    if (!card || workshop.setCardQuantity(card.id,quantity)) return;
    requestCard=card.id;
    requested=Math.max(1,Math.trunc(quantity));
    keep=new Set(Array.from({length:requested},(_,i)=>i+1));
  }
  function toggle(copy:number) {
    const next=new Set(keep);
    if(next.has(copy)) next.delete(copy); else next.add(copy);
    keep=next;
  }
</script>
{#if card}
  <Field label="Copies in deck">{#key `${card.id}:${requested ?? card.quantity}`}<NumberInput value={card.quantity} min={1} max={20} ariaLabel="Copies in deck" onchange={change}/>{/key}</Field>
  <dialog bind:this={dialog} oncancel={() => requested=null} aria-labelledby="keep-copy-title">
    {#if requested !== null}
      <h2 id="keep-copy-title">Choose {requested} {requested===1?'copy':'copies'} to keep</h2>
      <p>Reducing the quantity would remove customized copies. Select the copies to keep.</p>
      <div class="copies">
        {#each physicalCopies(card) as copy (copy)}
          <button type="button" aria-label={`Keep copy ${copy} of ${card.quantity}`} aria-pressed={keep.has(copy)} class:selected={keep.has(copy)}
            disabled={!keep.has(copy) && keep.size>=requested} onclick={() => toggle(copy)}>
            <div><CardRenderer {card} {copy} character={characterForCard(workshop.adventure,card)} theme={resolveStyleForCard(workshop.adventure,card)} customSymbols={workshop.adventure.customSymbols}/></div>
            Copy {copy}
          </button>
        {/each}
      </div>
      <p>{keep.size} of {requested} selected. This change can be undone.</p>
      <div class="actions"><Button onclick={() => requested=null}>Cancel</Button>
        <Button variant="primary" disabled={keep.size!==requested} onclick={() => {
          if(requested!==null && workshop.setCardQuantity(card.id,requested,[...keep].sort((a,b)=>a-b))) requested=null;
        }}>Keep selected copies</Button></div>
    {/if}
  </dialog>
{/if}
<style>
  dialog { max-width:700px; width:calc(100% - 32px); max-height:85dvh; overflow:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:var(--space-5); color:var(--text-primary); background:var(--surface-raised); }
  dialog::backdrop { background:color-mix(in srgb,var(--surface-sunken) 85%,transparent); }
  .copies { display:grid; grid-template-columns:repeat(auto-fill,minmax(100px,1fr)); gap:var(--space-3); }
  .copies button { background:var(--surface-inset); color:var(--text-primary); border:2px solid var(--border-subtle); border-radius:var(--radius-md); padding:var(--space-2); cursor:pointer; }
  .copies button.selected { border-color:var(--accent); }
  .copies button>div { pointer-events:none; }
  .actions { display:flex; justify-content:flex-end; gap:var(--space-3); }
</style>
