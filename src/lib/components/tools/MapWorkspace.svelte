<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { startPointerSession, type PointerSession } from '$lib/interaction/pointer-session';
  import { readMapWorkspaceWidths, writeMapWorkspaceWidths, type MapWorkspaceWidths } from '$lib/storage/settings';

  interface Props {
    canvas: Snippet;
    inspector: Snippet;
    layers: Snippet;
    boardSettings: Snippet;
    analysis: Snippet;
    selectionKey: string | null;
    selectionRevision: number;
  }
  let { canvas, inspector, layers, boardSettings, analysis, selectionKey, selectionRevision }: Props = $props();
  type Tab = 'inspector' | 'layers' | 'board' | 'analysis';
  type Mode = 'wide' | 'compact' | 'phone';
  type Divider = 'map' | 'layers';
  const defaults: MapWorkspaceWidths = { inspector: 440, layers: 360, sidebar: 380 };
  const MIN_INSPECTOR = 300;
  const MIN_LAYERS = 280;
  const MIN_SIDEBAR = 320;
  const MIN_MAP = 480;
  const HANDLE = 12;
  const tabs: { value: Tab; label: string }[] = [
    { value: 'inspector', label: 'Inspector' },
    { value: 'layers', label: 'Layers' },
    { value: 'board', label: 'Board' },
    { value: 'analysis', label: 'Analysis' }
  ];
  let root = $state<HTMLDivElement | null>(null);
  let available = $state(1200);
  let controlsHeight = $state(480);
  let mode = $state<Mode>('compact');
  let preferred = $state<MapWorkspaceWidths>({ ...defaults });
  let activeTab = $state<Tab>('layers');
  let resizeSession = $state.raw<PointerSession | null>(null);
  let changed = false;
  let persistence = Promise.resolve();
  const wide = $derived(mode === 'wide');
  const sideBudget = $derived(Math.max(MIN_INSPECTOR + MIN_LAYERS, available - MIN_MAP - HANDLE * 2));
  const inspectorWidth = $derived(Math.max(MIN_INSPECTOR, Math.min(preferred.inspector, sideBudget - MIN_LAYERS)));
  const layersWidth = $derived(Math.max(MIN_LAYERS, Math.min(preferred.layers, sideBudget - inspectorWidth)));
  const sidebarMaximum = $derived(Math.max(MIN_SIDEBAR, available - MIN_MAP - HANDLE));
  const sidebarWidth = $derived(Math.max(MIN_SIDEBAR, Math.min(preferred.sidebar, sidebarMaximum)));
  const inspectorMaximum = $derived(sideBudget - layersWidth);
  const layersMaximum = $derived(inspectorWidth + layersWidth - MIN_INSPECTOR);

  function remember(): void {
    changed = true;
    const widths = { ...preferred };
    persistence = persistence.then(async () => { await writeMapWorkspaceWidths(widths); });
  }

  function setWidth(divider: Divider, value: number, save = true): void {
    if (divider === 'layers') {
      const total = inspectorWidth + layersWidth;
      const layers = Math.max(MIN_LAYERS, Math.min(value, layersMaximum));
      preferred = { ...preferred, inspector: total - layers, layers };
    } else if (wide) {
      preferred = { ...preferred, inspector: Math.max(MIN_INSPECTOR, Math.min(value, inspectorMaximum)), layers: layersWidth };
    } else {
      preferred = { ...preferred, sidebar: Math.max(MIN_SIDEBAR, Math.min(value, sidebarMaximum)) };
    }
    changed = true;
    if (save) remember();
  }

  function resetWidths(): void {
    preferred = { ...defaults };
    remember();
  }

  function beginResize(event: PointerEvent, divider: Divider): void {
    resizeSession?.cancel('superseded');
    const width = divider === 'layers' ? layersWidth : wide ? inspectorWidth : sidebarWidth;
    resizeSession = startPointerSession(event, {
      snapshot: { width },
      onMove: (movement, _event, snapshot) => setWidth(divider, snapshot.width - movement.deltaX, false),
      onCommit: () => { resizeSession = null; remember(); },
      onCancel: () => { resizeSession = null; remember(); },
      onTap: () => { resizeSession = null; }
    });
  }

  function resizeWithKeyboard(event: KeyboardEvent, divider: Divider): void {
    const width = divider === 'layers' ? layersWidth : wide ? inspectorWidth : sidebarWidth;
    const minimum = divider === 'layers' ? MIN_LAYERS : wide ? MIN_INSPECTOR : MIN_SIDEBAR;
    const maximum = divider === 'layers' ? layersMaximum : wide ? inspectorMaximum : sidebarMaximum;
    const step = event.shiftKey ? 48 : 16;
    if (event.key === 'ArrowLeft') setWidth(divider, width + step);
    else if (event.key === 'ArrowRight') setWidth(divider, width - step);
    else if (event.key === 'Home') setWidth(divider, minimum);
    else if (event.key === 'End') setWidth(divider, maximum);
    else return;
    event.preventDefault();
  }

  let lastSelection: string | null = null;
  let lastSelectionRevision = -1;
  $effect(() => {
    if (selectionKey === lastSelection && selectionRevision === lastSelectionRevision) return;
    lastSelection = selectionKey;
    lastSelectionRevision = selectionRevision;
    if (selectionKey && !wide) activeTab = 'inspector';
  });

  function chooseTabWithKeyboard(event: KeyboardEvent): void {
    const visible = tabs.filter((tab) => !wide || tab.value !== 'inspector');
    let index = visible.findIndex((tab) => tab.value === activeTab);
    if (event.key === 'ArrowRight') index = (index + 1) % visible.length;
    else if (event.key === 'ArrowLeft') index = (index - 1 + visible.length) % visible.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = visible.length - 1;
    else return;
    event.preventDefault();
    activeTab = visible[index]!.value;
    void tick().then(() => root?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus());
  }

  onMount(() => {
    let alive = true;
    void readMapWorkspaceWidths().then((widths) => {
      if (alive && !changed && widths) preferred = widths;
    });
    const observer = new ResizeObserver(() => {
      if (!root) return;
      const width = root.clientWidth;
      const page = root.closest<HTMLElement>('.map-page');
      if (page) {
        const top = root.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop;
        controlsHeight = Math.max(240, page.clientHeight - top - 16);
      }
      const nextMode: Mode = width >= 1480 ? 'wide' : width >= 860 ? 'compact' : 'phone';
      if (width !== available) resizeSession?.cancel('viewport-change');
      available = width;
      if (nextMode !== mode) {
        const focused = document.activeElement;
        const focusWasInside = focused instanceof HTMLElement && root.contains(focused);
        mode = nextMode;
        if (wide && activeTab === 'inspector') activeTab = 'layers';
        void tick().then(() => {
          if (focusWasInside && focused instanceof HTMLElement && !focused.getClientRects().length) {
            root?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
          }
        });
      }
    });
    if (root) {
      observer.observe(root);
      const page = root.closest('.map-page');
      if (page) observer.observe(page);
    }
    return () => { alive = false; observer.disconnect(); resizeSession?.dispose(); };
  });
</script>

<div class="workspace" data-layout={mode} bind:this={root}
  style:--inspector-width="{inspectorWidth}px" style:--layers-width="{layersWidth}px" style:--sidebar-width="{sidebarWidth}px"
  style:--controls-height="{controlsHeight}px">
  <div class="canvas">{@render canvas()}</div>
  {#if mode !== 'phone'}
    <div class="divider" class:dragging={resizeSession !== null} role="slider" tabindex="0"
      aria-label={wide ? 'Resize map and Inspector' : 'Resize map and sidebar'} aria-orientation="vertical"
      aria-valuemin={wide ? MIN_INSPECTOR : MIN_SIDEBAR} aria-valuemax={Math.round(wide ? inspectorMaximum : sidebarMaximum)}
      aria-valuenow={Math.round(wide ? inspectorWidth : sidebarWidth)}
      aria-valuetext="{Math.round(wide ? inspectorWidth : sidebarWidth)} pixels wide"
      title="Drag to resize. Double-click to restore default widths."
      onpointerdown={(event) => beginResize(event, 'map')} onkeydown={(event) => resizeWithKeyboard(event, 'map')} ondblclick={resetWidths}></div>
  {/if}
  {#if wide}
    <section class="inspector scroll-y" aria-label="Map Inspector">{@render inspector()}</section>
    <div class="divider" class:dragging={resizeSession !== null} role="slider" tabindex="0"
      aria-label="Resize Inspector and Layers" aria-orientation="vertical"
      aria-valuemin={MIN_LAYERS} aria-valuemax={Math.round(layersMaximum)} aria-valuenow={Math.round(layersWidth)}
      aria-valuetext="{Math.round(layersWidth)} pixels wide"
      title="Drag to resize. Double-click to restore default widths."
      onpointerdown={(event) => beginResize(event, 'layers')} onkeydown={(event) => resizeWithKeyboard(event, 'layers')} ondblclick={resetWidths}></div>
  {/if}
  <aside class="sidebar" aria-label="Map settings">
    <div class="tabs" role="tablist" aria-label="Map settings sections">
      {#each tabs.filter((tab) => !wide || tab.value !== 'inspector') as tab}
        <button type="button" role="tab" id="map-settings-{tab.value}" aria-controls="map-settings-panel"
          tabindex={activeTab === tab.value ? 0 : -1} aria-selected={activeTab === tab.value}
          onclick={() => (activeTab = tab.value)} onkeydown={chooseTabWithKeyboard}>{tab.label}</button>
      {/each}
    </div>
    <div class="settings scroll-y" id="map-settings-panel" role="tabpanel" aria-labelledby="map-settings-{activeTab}">
      {#if activeTab === 'inspector' && !wide}{@render inspector()}
      {:else if activeTab === 'board'}{@render boardSettings()}
      {:else if activeTab === 'analysis'}{@render analysis()}
      {:else}{@render layers()}{/if}
    </div>
  </aside>
</div>

<style>
  .workspace { display:grid; grid-template-columns:minmax(0,1fr) 12px var(--sidebar-width); flex:none; min-height:0; min-width:0; align-items:start; }
  .workspace[data-layout='wide'] { grid-template-columns:minmax(0,1fr) 12px var(--inspector-width) 12px var(--layers-width); }
  .canvas, .inspector, .sidebar, .settings { min-width:0; min-height:0; }
  .canvas { display:flex; flex-direction:column; }
  .inspector { position:sticky; top:0; max-height:var(--controls-height); overscroll-behavior:contain; scrollbar-gutter:stable; }
  .sidebar { position:sticky; top:0; height:var(--controls-height); display:flex; flex-direction:column; border:1px solid var(--border-default); border-radius:var(--radius-sm); background:var(--surface-inset); }
  .settings { flex:1; padding:var(--space-3); overscroll-behavior:contain; scrollbar-gutter:stable; }
  .tabs { display:flex; flex:none; flex-wrap:wrap; border-bottom:1px solid var(--border-default); padding:var(--space-1); gap:var(--space-1); }
  .tabs button { flex:1; padding:var(--space-2); color:var(--text-secondary); font-size:var(--text-xs); border-radius:var(--radius-xs); }
  .tabs button[aria-selected='true'] { background:var(--accent-soft); color:var(--text-accent); }
  .divider { position:relative; align-self:stretch; cursor:col-resize; touch-action:none; user-select:none; }
  .divider::after { content:''; position:absolute; inset:var(--space-3) 5px; background:var(--border-default); border-radius:var(--radius-full); }
  .divider:hover::after, .divider.dragging::after, .divider:focus-visible::after { background:var(--accent); }
  .divider:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
  .workspace[data-layout='phone'] { grid-template-columns:minmax(0,1fr); grid-template-rows:auto auto; gap:var(--space-3); }
  @media (any-pointer:coarse) { .tabs button { min-height:var(--touch-target); } .divider::before { content:''; position:absolute; inset:0 -12px; } }
</style>
