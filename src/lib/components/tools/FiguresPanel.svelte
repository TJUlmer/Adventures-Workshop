<script lang="ts">
  /**
   * Figures, tokens and other physical components.
   *
   * A set is not just cards — it ships miniatures and markers, and those need
   * tracking too. Models and reference images are stored inside the document
   * for the same reason artwork is: the set has to survive being handed to
   * someone else as one file.
   */
  import { characterLabel } from '$lib/characters/factory';
  import { hasArtwork } from '$lib/core/artwork';
  import { saveExport, slugify } from '$lib/export';
  import { exportTokenModel, tokenTextureUrl } from '$lib/export/token-model';
  import type { Figure, FigureId, FigureKind } from '$lib/figures/types';
  import { FIGURE_KIND_LABELS, FIGURE_KINDS, figureLabel, tokenSpecOf } from '$lib/figures/types';
  import { HEALTH_DIAL_SPEC } from '$lib/figures/health-dial';
  import type { SkinTemplate } from '$lib/figures/skin-templates';
  import { HEALTH_DIAL_SKIN, TOKEN_SKIN } from '$lib/figures/skin-templates';
  import { isViewableModel, loadMesh } from '$lib/models/load';
  import type { Mesh } from '$lib/models/mesh';
  import type { TokenShape, TokenSpec } from '$lib/models/token';
  import type { TtsSave } from '$lib/models/tts';
  import { applyTtsEdits, parseTtsSave } from '$lib/models/tts';
  import {
    buildTokenMesh,
    MAX_POLYGON_SIDES,
    MIN_POLYGON_SIDES,
    TOKEN_SHAPE_LABELS,
    TOKEN_SHAPES
  } from '$lib/models/token';
  import { workshop } from '$lib/state/workshop.svelte';
  import {
    Button,
    ColorInput,
    EmptyState,
    Icon,
    NumberInput,
    Select,
    Switch,
    TextArea,
    TextInput
  } from '$lib/ui';
  import ModelViewer from './ModelViewer.svelte';

  const set = $derived(workshop.adventure);
  const figures = $derived(set.figures);

  let refInputs: Record<string, HTMLInputElement | null> = $state({});
  let modelInputs: Record<string, HTMLInputElement | null> = $state({});
  let error = $state<string | null>(null);

  const characterOptions = $derived([
    { value: '', label: 'Not tied to a character' },
    ...set.characters.map((character) => ({
      value: character.id as string,
      label: characterLabel(character)
    }))
  ]);

  const kindSegments = FIGURE_KINDS.map((kind) => ({
    value: kind,
    label: FIGURE_KIND_LABELS[kind]
  }));

  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });
  }

  async function pickReference(
    id: FigureId,
    event: Event & { currentTarget: HTMLInputElement }
  ): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    error = null;
    try {
      const source = await readAsDataUrl(file);
      workshop.editFigure(id, (figure) => {
        figure.reference.source = source;
        figure.reference.label = file.name;
      });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }

  async function pickModel(
    id: FigureId,
    event: Event & { currentTarget: HTMLInputElement }
  ): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    // Models get big fast; warn rather than silently blowing the storage quota.
    if (file.size > 8 * 1024 * 1024) {
      error = `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — too large to embed. Keep models under 8 MB.`;
      return;
    }

    error = null;
    try {
      const source = await readAsDataUrl(file);
      workshop.editFigure(id, (figure) => {
        figure.model = { name: file.name, source, size: file.size };
      });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function add(kind: FigureKind): void {
    workshop.addFigure(kind);
  }

  // -- previews -----------------------------------------------------------

  const shapeOptions = TOKEN_SHAPES.map((shape) => ({
    value: shape,
    label: TOKEN_SHAPE_LABELS[shape]
  }));

  interface Preview {
    mesh: Mesh;
    texture: string | null;
  }

  /**
   * Loaded models, keyed by figure. Held outside the document because a parsed
   * mesh is derived from the file and a great deal larger than it — the set
   * stores the bytes, not the triangles.
   */
  let loaded = $state<Record<string, Preview>>({});
  let loading = $state<Record<string, boolean>>({});
  let exportingId = $state<string | null>(null);

  /**
   * The mesh this figure is generated from, or `null` if it is not generated.
   *
   * A dial is a disc the app owns rather than one the author shapes, so its spec
   * is fixed and its build switch never appears — but it is the same generated
   * prism underneath, and going through the same path is what gets it the same
   * live preview.
   */
  function generatedSpec(figure: Figure): TokenSpec | null {
    if (figure.kind === 'dial') return HEALTH_DIAL_SPEC;
    return figure.token.enabled ? tokenSpecOf(figure.token) : null;
  }

  /**
   * A generated token is rebuilt whenever its dimensions change, which is what
   * makes the controls feel like they are shaping something rather than filling
   * in a form. An attached model is parsed once and kept.
   */
  const previews = $derived.by(() => {
    const built: Record<string, Preview> = {};
    for (const figure of figures) {
      const spec = generatedSpec(figure);
      if (!spec) continue;
      built[figure.id] = {
        mesh: buildTokenMesh(spec),
        texture: tokenTextures[figure.id] ?? null
      };
    }
    return built;
  });

  /**
   * A generated piece carries its own baked texture; an attached model wears the
   * reference image straight, read live so swapping the picture reskins it
   * without reloading the mesh.
   */
  function preview(figure: Figure): Preview | null {
    const token = previews[figure.id];
    if (token) return token;
    const model = loaded[figure.id];
    if (model) return { mesh: model.mesh, texture: figure.reference.source ?? null };
    return null;
  }

  /** Token textures, drawn off the reference image and cached per figure. */
  let tokenTextures = $state<Record<string, string>>({});

  $effect(() => {
    for (const figure of figures) {
      if (!generatedSpec(figure)) continue;
      /* Reading these is what makes a change to any of them rebuild the texture.
         `kind` is in there because a dial takes the app's rim rather than the
         figure's, so becoming one changes the texture without changing a field. */
      const key = `${figure.kind}|${figure.reference.source ?? ''}|${figure.token.rimColor}|${figure.token.twoSided}`;
      if (textureKeys[figure.id] === key) continue;
      textureKeys[figure.id] = key;

      if (!figure.reference.source) {
        delete tokenTextures[figure.id];
        continue;
      }
      void tokenTextureUrl(figure).then((url) => {
        if (url) tokenTextures[figure.id] = url;
      });
    }
  });

  const textureKeys: Record<string, string> = {};

  /** Parse an attached model the first time it is on screen, and keep it. */
  $effect(() => {
    for (const figure of figures) {
      if (loaded[figure.id] || loading[figure.id]) continue;

      const model = figure.model;
      if (!model?.source || !isViewableModel(model.name)) continue;
      const source = { name: model.name, url: model.source };

      loading[figure.id] = true;
      void loadMesh(source.name, source.url)
        .then((mesh) => {
          loaded[figure.id] = { mesh, texture: null };
        })
        .catch((cause: unknown) => {
          error = cause instanceof Error ? cause.message : 'Could not read that model.';
        })
        .finally(() => {
          delete loading[figure.id];
        });
    }
  });

  /** Kind-driven visibility. A dial is a fixed component; the rest are built. */
  const isDial = (figure: Figure): boolean => figure.kind === 'dial';
  const sidesLabel = (figure: Figure): string =>
    figure.token.shape === 'polygon' ? 'Across the flats' : 'Diameter';

  /** The assigned character's name, for the dial's default name. */
  function ownerName(figure: Figure): string | null {
    const character = set.characters.find((entry) => entry.id === figure.characterId);
    return character ? characterLabel(character) : null;
  }

  /** What the name will fall back to — a dial names itself after its figure. */
  function namePlaceholder(figure: Figure): string {
    const owner = ownerName(figure);
    if (figure.kind === 'dial' && owner) return `${owner}'s health dial`;
    return FIGURE_KIND_LABELS[figure.kind];
  }

  /**
   * What the picture is *for*, which differs by kind: a dial wears it on its
   * face, a sculpted figure is skinned with it, and everything else is working
   * from it.
   */
  function imageLabel(figure: Figure): string {
    if (figure.kind === 'dial') return 'Dial face';
    if (figure.kind === 'figure') return 'Model texture';
    return 'Reference image';
  }

  // -- Tabletop Simulator objects -----------------------------------------

  let ttsInputs: Record<string, HTMLInputElement | null> = $state({});

  /**
   * Parsed saves, keyed by figure. Held outside the document for the same
   * reason meshes are: the set stores the file, and this is a reading of it.
   */
  let tts = $state<Record<string, TtsSave>>({});
  const ttsKeys: Record<string, string> = {};

  $effect(() => {
    for (const figure of figures) {
      const save = figure.ttsSave;
      if (!save?.source) {
        delete tts[figure.id];
        delete ttsKeys[figure.id];
        continue;
      }
      if (ttsKeys[figure.id] === save.source) continue;
      ttsKeys[figure.id] = save.source;
      try {
        tts[figure.id] = parseTtsSave(atob(save.source.split(',')[1] ?? ''));
      } catch (cause) {
        error = cause instanceof Error ? cause.message : 'Could not read that file.';
        delete tts[figure.id];
      }
    }
  });

  async function pickTts(
    id: FigureId,
    event: Event & { currentTarget: HTMLInputElement }
  ): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    error = null;
    try {
      const text = await file.text();
      // Parsed first, so a file that is not one of these never reaches the set.
      parseTtsSave(text);
      workshop.editFigure(id, (figure) => {
        figure.ttsSave = {
          name: file.name,
          source: `data:application/json;base64,${btoa(unescape(encodeURIComponent(text)))}`,
          size: file.size
        };
      });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not read that file.';
    }
  }

  /** Edits go to the parsed copy and straight back into the stored file. */
  function editTts(id: string, mutate: (object: TtsSave['object']) => void): void {
    const save = tts[id];
    if (!save) return;
    mutate(save.object);
    const text = applyTtsEdits(save);
    const encoded = `data:application/json;base64,${btoa(unescape(encodeURIComponent(text)))}`;
    ttsKeys[id] = encoded;
    workshop.editFigure(id as FigureId, (figure) => {
      if (figure.ttsSave) figure.ttsSave = { ...figure.ttsSave, source: encoded, size: text.length };
    });
  }

  function saveTts(figure: Figure): void {
    const save = tts[figure.id];
    if (!save) return;
    saveExport({
      filename: figure.ttsSave?.name || `${slugify(figureLabel(figure), 'object')}.json`,
      mimeType: 'application/json',
      blob: new Blob([applyTtsEdits(save)], { type: 'application/json' })
    });
  }

  async function exportToken(figure: Figure): Promise<void> {
    exportingId = figure.id;
    error = null;
    try {
      saveExport(await exportTokenModel(figure));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not build the model.';
    } finally {
      exportingId = null;
    }
  }
</script>

<!--
  A skin template, offered where the component that wears it is configured.
  Opened in a new tab because it leaves the app — the one place this otherwise
  offline thing reaches out, and a link rather than a fetch so it stays the
  author's choice.
-->
{#snippet skinLink(template: SkinTemplate, note: string)}
  <p class="hint">
    {note}
    <a class="skin-link" href={template.url} target="_blank" rel="noreferrer noopener">
      <Icon name="download" size={12} />
      {template.label}
    </a>
  </p>
{/snippet}

<div class="page scroll-y">
  <header class="head">
    <div>
      <span class="eyebrow">Set tool</span>
      <h1 class="title">Components</h1>
      <p class="lede">Miniatures, tokens and anything else that goes in the box.</p>
    </div>

    <div class="head-actions">
      {#each kindSegments as kind (kind.value)}
        <Button size="sm" onclick={() => add(kind.value)}>
          <Icon name="plus" size={13} />
          {kind.label}
        </Button>
      {/each}
    </div>
  </header>

  {#if error}<p class="error">{error}</p>{/if}

  {#if figures.length === 0}
    <EmptyState
      icon="users"
      title="No components listed"
      description="Track the miniatures and tokens your adventure needs, with reference art and model files."
    >
      {#snippet actions()}
        <Button variant="primary" onclick={() => add('figure')}>
          <Icon name="plus" size={13} />
          Add a figure
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <ul class="list">
      {#each figures as figure (figure.id)}
        <li class="figure">
          <input
            bind:this={refInputs[figure.id]}
            class="sr-only"
            type="file"
            accept="image/*"
            onchange={(event) => pickReference(figure.id, event)}
          />
          <input
            bind:this={modelInputs[figure.id]}
            class="sr-only"
            type="file"
            accept=".stl,.obj,.3mf,.ply,model/*"
            onchange={(event) => pickModel(figure.id, event)}
          />
          <input
            bind:this={ttsInputs[figure.id]}
            class="sr-only"
            type="file"
            accept=".json,application/json"
            onchange={(event) => pickTts(figure.id, event)}
          />

          <button
            type="button"
            class="thumb"
            class:empty={!hasArtwork(figure.reference)}
            title="Choose reference art"
            onclick={() => refInputs[figure.id]?.click()}
          >
            {#if hasArtwork(figure.reference) && figure.reference.source}
              <img src={figure.reference.source} alt="" />
            {:else}
              <Icon name="image" size={18} />
            {/if}
          </button>

          <div class="fields">
            <div class="row">
              <TextInput
                value={figure.name}
                placeholder={namePlaceholder(figure)}
                oninput={(event) =>
                  workshop.editFigure(figure.id, (f) => (f.name = event.currentTarget.value))}
              />

              <Select
                value={figure.kind}
                options={kindSegments}
                onchange={(kind) =>
                  workshop.editFigure(figure.id, (f) => (f.kind = kind as FigureKind))}
              />

              <NumberInput
                value={figure.quantity}
                min={1}
                max={40}
                onchange={(quantity) =>
                  workshop.editFigure(figure.id, (f) => (f.quantity = quantity))}
              />
            </div>

            <div class="row single">
              <Select
                value={figure.characterId ?? ''}
                options={characterOptions}
                onchange={(next) =>
                  workshop.editFigure(
                    figure.id,
                    (f) => (f.characterId = next === '' ? null : (next as never))
                  )}
              />
            </div>

            <!--
              The sources a component is made from, each labelled with what it is
              for so the three are not a row of near-identical buttons. A health
              dial supplies its own model and script, so it is only ever a face.
            -->
            <div class="sources">
              <div class="source">
                <span class="source-label">{imageLabel(figure)}</span>
                {#if hasArtwork(figure.reference)}
                  <span class="source-value" title={figure.reference.label || imageLabel(figure)}>
                    {figure.reference.label || imageLabel(figure)}
                  </span>
                  <button
                    type="button"
                    class="ghost"
                    title="Replace image"
                    aria-label="Replace image"
                    onclick={() => refInputs[figure.id]?.click()}
                  >
                    <Icon name="upload" size={12} />
                  </button>
                  <button
                    type="button"
                    class="ghost"
                    title="Remove image"
                    aria-label="Remove image"
                    onclick={() =>
                      workshop.editFigure(figure.id, (f) => {
                        f.reference.source = null;
                        f.reference.label = '';
                      })}
                  >
                    <Icon name="minus" size={12} />
                  </button>
                {:else}
                  <button
                    type="button"
                    class="ghost wide"
                    onclick={() => refInputs[figure.id]?.click()}
                  >
                    <Icon name="image" size={12} />
                    {isDial(figure) ? 'Attach the dial face' : 'Attach an image'}
                  </button>
                {/if}
              </div>

              <!--
                A build turns a token into a generated prism, so its model and
                TTS-save controls would only compete with it — they show only
                when the build is off. A dial has neither; it is its own model.
              -->
              {#if !isDial(figure) && !figure.token.enabled}
                <!-- A sculpt to print or drop into Tabletop Simulator. -->
                <div class="source">
                  <span class="source-label">3D model</span>
                  {#if figure.model}
                    <span class="source-value" title={figure.model.name}>{figure.model.name}</span>
                    <span class="model-size numeric">{formatSize(figure.model.size)}</span>
                    <button
                      type="button"
                      class="ghost"
                      title="Remove model"
                      aria-label="Remove model"
                      onclick={() => workshop.editFigure(figure.id, (f) => (f.model = null))}
                    >
                      <Icon name="minus" size={12} />
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="ghost wide"
                      onclick={() => modelInputs[figure.id]?.click()}
                    >
                      <Icon name="upload" size={12} />
                      Attach an STL or OBJ
                    </button>
                  {/if}
                </div>

                <!--
                  A ready-made Tabletop Simulator object, kept whole and edited in
                  the few places that decide what the component *is*. Its settings
                  appear below once attached. See `models/tts.ts`.
                -->
                <div class="source">
                  <span class="source-label">TTS object</span>
                  {#if figure.ttsSave}
                    <span class="source-value" title={figure.ttsSave.name}>{figure.ttsSave.name}</span>
                    <span class="model-size numeric">{formatSize(figure.ttsSave.size)}</span>
                    <button
                      type="button"
                      class="ghost"
                      title="Remove the Tabletop Simulator object"
                      aria-label="Remove Tabletop Simulator object"
                      onclick={() => workshop.editFigure(figure.id, (f) => (f.ttsSave = null))}
                    >
                      <Icon name="minus" size={12} />
                    </button>
                  {:else}
                    <button type="button" class="ghost wide" onclick={() => ttsInputs[figure.id]?.click()}>
                      <Icon name="upload" size={12} />
                      Attach a .json save
                    </button>
                  {/if}
                </div>
              {/if}
            </div>

            {#if isDial(figure)}
              <!--
                The dial's settings beside the instructions that come with it:
                the range it counts is the author's, the instructions are the
                component's own and are the same on every dial.
              -->
              <div class="notes">
                <div class="note-block">
                  <span class="block-title">Value range</span>

                  <div class="token-fields">
                    <label class="field">
                      <span class="field-label">Lowest</span>
                      <NumberInput
                        value={figure.dialRange.min}
                        min={0}
                        max={98}
                        onchange={(min) =>
                          workshop.editFigure(figure.id, (f) => {
                            f.dialRange.min = min;
                            if (f.dialRange.max <= min) f.dialRange.max = min + 1;
                          })}
                      />
                    </label>

                    <label class="field">
                      <span class="field-label">Highest (starts here)</span>
                      <NumberInput
                        value={figure.dialRange.max}
                        min={figure.dialRange.min + 1}
                        max={99}
                        onchange={(max) =>
                          workshop.editFigure(figure.id, (f) => (f.dialRange.max = max))}
                      />
                    </label>
                  </div>

                  <p class="hint">
                    The dial's disc and counter are built in — it counts from
                    {figure.dialRange.min} to {figure.dialRange.max} and starts full.
                    The image is applied to its face on export.
                  </p>
                </div>

                <div class="note-block">
                  <span class="block-title">On the table</span>
                  <p class="hint">
                    A {HEALTH_DIAL_SPEC.diameterMm}mm disc showing the current health,
                    with a trigger either side of the number: click the right one to
                    raise it, the left one to lower it. Click the number, or alt-click
                    a trigger, to put the dial back to full.
                  </p>
                  {@render skinLink(HEALTH_DIAL_SKIN, 'The face is a square, the disc inscribed in it.')}
                </div>
              </div>
            {/if}

            <!--
              A token built here from the picture: a flat prism the reference art
              wraps onto. A miniature or a piece with a sculpt turns this off and
              attaches a model instead; a token and a game piece start with it on.
              Hidden for a dial, which is its own fixed model.
            -->
            {#if !isDial(figure)}
              <div class="build">
                <Switch
                  label="Build a token from the image"
                  hint="A flat disc or polygon carrying the reference art, for the table or for Tabletop Simulator."
                  checked={figure.token.enabled}
                  onchange={(enabled) =>
                    workshop.editFigure(figure.id, (f) => (f.token.enabled = enabled))}
                />

                {#if figure.token.enabled}
                  <div class="token-fields">
                    <label class="field">
                      <span class="field-label">Shape</span>
                      <Select
                        value={figure.token.shape}
                        options={shapeOptions}
                        onchange={(shape) =>
                          workshop.editFigure(
                            figure.id,
                            (f) => (f.token.shape = shape as TokenShape)
                          )}
                      />
                    </label>

                    {#if figure.token.shape === 'polygon'}
                      <label class="field">
                        <span class="field-label">Sides</span>
                        <NumberInput
                          value={figure.token.sides}
                          min={MIN_POLYGON_SIDES}
                          max={MAX_POLYGON_SIDES}
                          onchange={(sides) =>
                            workshop.editFigure(figure.id, (f) => (f.token.sides = sides))}
                        />
                      </label>
                    {/if}

                    <label class="field">
                      <span class="field-label">{sidesLabel(figure)}</span>
                      <NumberInput
                        value={figure.token.diameterMm}
                        min={5}
                        max={200}
                        onchange={(mm) =>
                          workshop.editFigure(figure.id, (f) => (f.token.diameterMm = mm))}
                      />
                    </label>

                    <label class="field">
                      <span class="field-label">Thickness</span>
                      <NumberInput
                        value={figure.token.thicknessMm}
                        min={1}
                        max={30}
                        onchange={(mm) =>
                          workshop.editFigure(figure.id, (f) => (f.token.thicknessMm = mm))}
                      />
                    </label>

                    {#if !figure.token.twoSided}
                      <label class="field">
                        <span class="field-label">Rim</span>
                        <ColorInput
                          value={figure.token.rimColor}
                          inherited={figure.token.rimColor}
                          onchange={(color) =>
                            workshop.editFigure(
                              figure.id,
                              (f) => (f.token.rimColor = color ?? '#1a1a1a')
                            )}
                        />
                      </label>
                    {/if}
                  </div>

                  <Switch
                    label="Two-sided art"
                    hint="The image is two faces side by side — front on the left, back on the right — wrapped one to each side. Off, the one picture is shown on both."
                    checked={figure.token.twoSided}
                    onchange={(twoSided) =>
                      workshop.editFigure(figure.id, (f) => (f.token.twoSided = twoSided))}
                  />

                  <div class="notes">
                    <div class="note-block">
                      <span class="block-title">This piece</span>
                      <p class="hint">
                        {figure.token.shape === 'polygon'
                          ? `${figure.token.sides}-sided polygon`
                          : 'Circle'},
                        {figure.token.diameterMm}mm across and {figure.token.thicknessMm}mm thick.
                        Exports as an OBJ, its material and a texture, with a note on
                        importing it.
                      </p>
                    </div>

                    <div class="note-block">
                      <span class="block-title">Painting it</span>
                      {#if figure.token.twoSided}
                        <p class="hint">
                          The image is read as two squares side by side — the left one
                          goes on top, the right on the underside — and the pixel at the
                          dead centre is what paints the piece's edge.
                        </p>
                        {@render skinLink(TOKEN_SKIN, 'The template has all three marked.')}
                      {:else}
                        <p class="hint">
                          One square, the piece's outline inscribed in it, shown on both
                          faces. The rim colour above fills the edge. Turn on two-sided
                          art to give the underside its own picture.
                        </p>
                        {@render skinLink(TOKEN_SKIN, 'The two-sided template, for when you do.')}
                      {/if}
                    </div>
                  </div>

                  <div class="build-actions">
                    <Button
                      size="sm"
                      disabled={!hasArtwork(figure.reference) || exportingId === figure.id}
                      onclick={() => exportToken(figure)}
                    >
                      <Icon name="download" size={13} />
                      {exportingId === figure.id ? 'Building…' : 'Export model'}
                    </Button>
                    {#if !hasArtwork(figure.reference)}
                      <span class="hint">Attach a reference image first — it is what goes on it.</span>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          <button
            type="button"
            class="ghost remove"
            title="Remove {figureLabel(figure)}"
            aria-label="Remove component"
            onclick={() => workshop.removeFigure(figure.id)}
          >
            <Icon name="trash" size={13} />
          </button>

          {#if figure.ttsSave}
            {@const save = tts[figure.id]}
            {#if save}
            <div class="tts">
              <div class="tts-head">
                <span class="tts-kind">{save.object.kind.replace(/_/g, ' ')}</span>
                {#if save.objectCount > 1}
                  <span class="hint">
                    {save.objectCount} objects in the file — the first is the one shown.
                  </span>
                {/if}
                <Button size="sm" onclick={() => saveTts(figure)}>
                  <Icon name="download" size={13} />
                  Save JSON
                </Button>
              </div>

              <div class="token-fields">
                <label class="field">
                  <span class="field-label">Name in game</span>
                  <TextInput
                    value={save.object.nickname}
                    oninput={(event) => editTts(figure.id, (o) => (o.nickname = event.currentTarget.value))}
                  />
                </label>
                <label class="field">
                  <span class="field-label">Description</span>
                  <TextInput
                    value={save.object.description}
                    oninput={(event) =>
                      editTts(figure.id, (o) => (o.description = event.currentTarget.value))}
                  />
                </label>
              </div>

              <!--
                The model and its skin are hosted, not embedded — Tabletop
                Simulator fetches them by URL. Point them at your own uploads
                and the component is yours.
              -->
              {#if save.object.meshUrl || save.object.diffuseUrl}
                <div class="token-fields">
                  <label class="field">
                    <span class="field-label">Model URL</span>
                    <TextInput
                      value={save.object.meshUrl}
                      oninput={(event) =>
                        editTts(figure.id, (o) => (o.meshUrl = event.currentTarget.value))}
                    />
                  </label>
                  <label class="field">
                    <span class="field-label">Texture URL</span>
                    <TextInput
                      value={save.object.diffuseUrl}
                      oninput={(event) =>
                        editTts(figure.id, (o) => (o.diffuseUrl = event.currentTarget.value))}
                    />
                  </label>
                </div>
                <p class="hint">
                  Those are hosted files, so they cannot be drawn here — download the model and
                  attach it above to see it.
                </p>
              {/if}

              {#if save.object.config.length > 0}
                <span class="field-label">Script settings</span>
                <div class="token-fields">
                  {#each save.object.config as entry, index (entry.key)}
                    <label class="field">
                      <span class="field-label">{entry.key.replace(/_/g, ' ').toLowerCase()}</span>
                      {#if typeof entry.value === 'boolean'}
                        <Switch
                          label={entry.key}
                          checked={entry.value}
                          onchange={(next) =>
                            editTts(figure.id, (o) => {
                              const target = o.config[index];
                              if (target) target.value = next;
                            })}
                        />
                      {:else if typeof entry.value === 'number'}
                        <NumberInput
                          value={entry.value}
                          min={-9999}
                          max={9999}
                          onchange={(next) =>
                            editTts(figure.id, (o) => {
                              const target = o.config[index];
                              if (target) target.value = next;
                            })}
                        />
                      {:else}
                        <TextInput
                          value={entry.value}
                          oninput={(event) => {
                            const next = event.currentTarget.value;
                            editTts(figure.id, (o) => {
                              const target = o.config[index];
                              if (target) target.value = next;
                            });
                          }}
                        />
                      {/if}
                    </label>
                  {/each}
                </div>
              {/if}
            </div>
            {/if}
          {/if}

          {#if preview(figure)}
            {@const shown = preview(figure)}
            <div class="preview">
              <ModelViewer mesh={shown?.mesh ?? null} texture={shown?.texture ?? null} />
            </div>
          {:else if figure.model && !isViewableModel(figure.model.name)}
            <p class="preview-note">
              {figure.model.name} is stored with the set, but only STL and OBJ can be shown here.
            </p>
          {/if}

          <!-- Notes sit below the preview, out of the way of what the piece is. -->
          {#if !isDial(figure)}
            <div class="notes-row">
              <TextArea
                value={figure.notes}
                rows={2}
                placeholder="Sculpt notes, base size, print settings…"
                oninput={(event) =>
                  workshop.editFigure(figure.id, (f) => (f.notes = event.currentTarget.value))}
              />
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .page {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-7) var(--space-8) var(--space-10);
  }

  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-5);
  }

  .head-actions {
    display: flex;
    gap: var(--space-2);
  }

  .eyebrow {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .title {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .lede {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .error {
    font-size: var(--text-xs);
    color: var(--danger);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 880px;
  }

  /*
   * Three columns for the row, and the preview spans all of them underneath —
   * a model wants the width, and putting it in a fourth column would squeeze
   * the fields it is meant to be read alongside.
   */
  .figure {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--space-4);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
  }

  .preview,
  .preview-note,
  .notes-row {
    grid-column: 1 / -1;
  }

  .preview-note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  /* -- building a token -------------------------------------------------- */
  .build {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
  }

  .token-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: var(--space-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .field-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  /* -- health dial: its settings, and what it comes with ----------------- */
  .notes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
    align-items: start;
  }

  .note-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-inset);
    border: 1px solid var(--border-subtle);
  }

  .block-title {
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  /* Sits on its own line under the copy it belongs to, not run into it. */
  .skin-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-1);
    color: var(--text-accent, var(--text-secondary));
    text-decoration: none;
    border-bottom: 1px solid currentColor;
  }

  .skin-link:hover {
    color: var(--text-primary);
  }

  /* -- a Tabletop Simulator object --------------------------------------- */
  .tts {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background: var(--surface-inset);
    border: 1px solid var(--border-subtle);
  }

  .tts-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .tts-kind {
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .tts-head :global(button) {
    margin-left: auto;
  }

  .build-actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }

  .thumb {
    display: grid;
    place-items: center;
    width: 72px;
    height: 72px;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    color: var(--text-muted);
  }

  .thumb.empty {
    border-style: dashed;
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
  }

  .row.single {
    grid-template-columns: minmax(0, 1fr);
  }

  /* -- sources: image, model, TTS object --------------------------------- */
  .sources {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .source {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    height: 32px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
  }

  /* The fixed leading word that says what this source is for. */
  .source-label {
    flex: 0 0 5.5rem;
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .source-value {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model-size {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    height: 22px;
    padding-inline: var(--space-2);
    border-radius: var(--radius-xs);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .ghost.wide {
    width: 100%;
  }

  /* Beside a source label, the attach button takes the rest of the row. */
  .source .ghost.wide {
    flex: 1 1 auto;
    width: auto;
  }

  .ghost:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .remove {
    height: 26px;
  }

  .remove:hover {
    color: var(--danger);
  }
</style>
