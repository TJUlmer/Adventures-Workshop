<script lang="ts">
  /**
   * Descriptive deck statistics and official context. Domain calculations and
   * cohort selection stay in `$lib/analysis`; this screen owns presentation.
   */
  import {
    analyseCharacter,
    compareCharacterWithOfficial,
    findClosestOfficialProfiles,
    type OfficialComparisonRow
  } from '$lib/analysis';
  import {
    OFFICIAL_CATALOGUE_VERSION,
    officialCatalogueRows,
    type OfficialAttackType,
    type OfficialCatalogueRow,
    type OfficialDataStatus,
    type OfficialRosterType
  } from '$lib/analysis/official';
  import { COMBAT_SYMBOLS, type CombatSymbol } from '$lib/cards/types';
  import {
    ATTACK_TYPE_LABELS,
    CHARACTER_ROLE_META,
    type CharacterId
  } from '$lib/characters/types';
  import { workshop } from '$lib/state/workshop.svelte';
  import { Badge, EmptyState, Icon, Select, TextInput } from '$lib/ui';

  type SortKey = 'name' | 'set' | 'year' | 'fighters' | 'range' | 'move' | 'health';
  type SortDirection = 'ascending' | 'descending';

  // Keep the explorer implementation ready without exposing the catalogue before it is needed.
  const SHOW_OFFICIAL_CATALOGUE = false;

  const COMBAT_META: Readonly<
    Record<CombatSymbol, { label: string; shortLabel: string; colorVar: string }>
  > = {
    attack: { label: 'Attack', shortLabel: 'A', colorVar: '--kind-attack' },
    defense: { label: 'Defense', shortLabel: 'D', colorVar: '--kind-defense' },
    versatile: { label: 'Versatile', shortLabel: 'V', colorVar: '--kind-versatile' },
    scheme: { label: 'Scheme', shortLabel: 'S', colorVar: '--analysis-scheme' }
  };

  const ROSTER_LABELS: Readonly<Record<OfficialRosterType, string>> = {
    solo: 'Solo',
    'hero-with-sidekick': 'Hero + sidekick',
    'hero-with-multiple-sidekicks': 'Hero + multiple sidekicks',
    team: 'Team',
    transforming: 'Transforming'
  };

  const ATTACK_LABELS: Readonly<Record<OfficialAttackType, string>> = {
    melee: 'Melee',
    ranged: 'Ranged',
    hybrid: 'Mixed range',
    none: 'No attack range'
  };

  const STATUS_LABELS: Readonly<Record<OfficialDataStatus, string>> = {
    complete: 'Complete',
    'needs-review': 'Needs review',
    partial: 'Partial'
  };

  const set = $derived(workshop.adventure);
  const subjects = $derived(
    set.characters.filter((character) =>
      set.decks.some((deck) => deck.kind === 'action' && deck.ownerId === character.id)
    )
  );
  let selectedCharacterId = $state<CharacterId | ''>('');

  /* Browsing analysis must not move the editor's card selection elsewhere. */
  $effect(() => {
    if (subjects.some((character) => character.id === selectedCharacterId)) return;
    const editorSubject = workshop.previewCharacter;
    const currentEditorSubject =
      editorSubject && subjects.some((character) => character.id === editorSubject.id)
        ? editorSubject
        : null;
    const preferred =
      (currentEditorSubject?.role === 'hero' ? currentEditorSubject : null) ??
      subjects.find((character) => character.role === 'hero') ??
      currentEditorSubject ??
      subjects[0];
    selectedCharacterId = preferred?.id ?? '';
  });

  const subjectOptions = $derived(
    subjects.map((character) => ({
      value: character.id,
      label: `${character.name || 'Untitled character'} · ${CHARACTER_ROLE_META[character.role].label}`
    }))
  );
  const analysis = $derived(
    selectedCharacterId ? analyseCharacter(set, selectedCharacterId) : null
  );
  const deckNames = $derived.by(() => {
    if (!analysis) return [];
    const ids = new Set(analysis.actionDeckIds);
    return set.decks.filter((deck) => ids.has(deck.id)).map((deck) => deck.name || 'Action deck');
  });
  const officialComparisons = $derived(
    analysis ? compareCharacterWithOfficial(analysis) : []
  );
  const closestOfficialProfiles = $derived(
    analysis ? findClosestOfficialProfiles(analysis) : null
  );

  let search = $state('');
  let setFilter = $state('all');
  let fighterFilter = $state('all');
  let attackFilter = $state('all');
  let moveFilter = $state('all');
  let healthFilter = $state('all');
  let eraFilter = $state('all');
  let sortKey = $state<SortKey>('name');
  let sortDirection = $state<SortDirection>('ascending');

  const setOptions = $derived.by(() => [
    { value: 'all', label: 'All official sets' },
    ...[...new Map(officialCatalogueRows.map((row) => [row.releaseId, row.setName])).entries()]
      .sort((left, right) => left[1].localeCompare(right[1]))
      .map(([value, label]) => ({ value, label }))
  ]);

  const fighterOptions = $derived.by(() => {
    const counts = [
      ...new Set(
        officialCatalogueRows
          .map((row) => row.fighterCount)
          .filter((count): count is number => count !== null)
      )
    ].sort((left, right) => left - right);
    const options = [
      { value: 'all', label: 'Any fighter count' },
      ...counts.map((count) => ({
        value: String(count),
        label: `${count} ${count === 1 ? 'fighter' : 'fighters'}`
      }))
    ];
    if (officialCatalogueRows.some((row) => row.fighterCount === null)) {
      options.push({ value: 'unknown', label: 'Count not fully known' });
    }
    return options;
  });

  const attackOptions = $derived.by(() => {
    const order: readonly OfficialAttackType[] = ['melee', 'ranged', 'hybrid', 'none'];
    const present = new Set(officialCatalogueRows.map((row) => row.primaryAttackType));
    return [
      { value: 'all', label: 'Any attack range' },
      ...order
        .filter((attackType) => present.has(attackType))
        .map((attackType) => ({ value: attackType, label: ATTACK_LABELS[attackType] }))
    ];
  });

  const moveOptions = $derived.by(() => [
    { value: 'all', label: 'Any Move' },
    ...[...new Set(officialCatalogueRows.map((row) => row.move))]
      .sort((left, right) => left - right)
      .map((move) => ({ value: String(move), label: `Move ${move}` }))
  ]);

  const healthOptions = $derived.by(() => [
    { value: 'all', label: 'Any hero health' },
    ...[
      ...new Set(
        officialCatalogueRows
          .map((row) => row.primaryHealth)
          .filter((health): health is number => health !== null)
      )
    ]
      .sort((left, right) => left - right)
      .map((health) => ({ value: String(health), label: `${health} health` }))
  ]);

  function eraStart(year: number): number {
    return Math.floor(year / 5) * 5;
  }

  const eraOptions = $derived.by(() => [
    { value: 'all', label: 'Any release era' },
    ...[...new Set(officialCatalogueRows.map((row) => eraStart(row.releaseYear)))]
      .sort((left, right) => left - right)
      .map((start) => ({ value: String(start), label: `${start}–${start + 4}` }))
  ]);

  function sortValue(row: OfficialCatalogueRow, key: SortKey): string | number | null {
    if (key === 'name') return row.name;
    if (key === 'set') return row.setName;
    if (key === 'year') return row.releaseYear;
    if (key === 'fighters') return row.fighterCount;
    if (key === 'range') return row.primaryAttackType;
    if (key === 'move') return row.move;
    return row.primaryHealth;
  }

  function compareRows(left: OfficialCatalogueRow, right: OfficialCatalogueRow): number {
    const leftValue = sortValue(left, sortKey);
    const rightValue = sortValue(right, sortKey);
    if (leftValue === null) return rightValue === null ? left.name.localeCompare(right.name) : 1;
    if (rightValue === null) return -1;
    const order =
      typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue));
    if (order !== 0) return sortDirection === 'ascending' ? order : -order;
    return left.name.localeCompare(right.name);
  }

  const filteredCatalogue = $derived.by(() => {
    const query = search.trim().toLocaleLowerCase();
    const era = eraFilter === 'all' ? null : Number(eraFilter);
    const fighterCount =
      fighterFilter === 'all' || fighterFilter === 'unknown' ? null : Number(fighterFilter);
    const move = moveFilter === 'all' ? null : Number(moveFilter);
    const health = healthFilter === 'all' ? null : Number(healthFilter);

    return officialCatalogueRows
      .filter((row) => {
        if (
          query &&
          ![row.name, row.setName, row.licence ?? '', ROSTER_LABELS[row.rosterType]]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query)
        ) return false;
        if (setFilter !== 'all' && row.releaseId !== setFilter) return false;
        if (fighterFilter === 'unknown' && row.fighterCount !== null) return false;
        if (fighterCount !== null && row.fighterCount !== fighterCount) return false;
        if (attackFilter !== 'all' && row.primaryAttackType !== attackFilter) return false;
        if (move !== null && row.move !== move) return false;
        if (health !== null && row.primaryHealth !== health) return false;
        if (era !== null && eraStart(row.releaseYear) !== era) return false;
        return true;
      })
      .sort(compareRows);
  });

  function pickSort(key: SortKey): void {
    if (sortKey === key) {
      sortDirection = sortDirection === 'ascending' ? 'descending' : 'ascending';
      return;
    }
    sortKey = key;
    sortDirection = key === 'year' ? 'descending' : 'ascending';
  }

  function formatNumber(value: number | null, digits = 1): string {
    if (value === null) return '—';
    return value.toFixed(digits).replace(/\.0$/, '');
  }

  function countLabel(designs: number, copies: number): string {
    return `${designs} ${designs === 1 ? 'design' : 'designs'} · ${copies} ${copies === 1 ? 'copy' : 'copies'}`;
  }

  function coverageLabel(coverage: number | null): string {
    return coverage === null ? 'No cards in category' : `${Math.round(coverage * 100)}% complete`;
  }

  function fighterCountLabel(row: OfficialCatalogueRow): string {
    return row.fighterCount === null ? `At least ${row.knownFighterCount}` : String(row.fighterCount);
  }

  function comparisonPosition(value: number | null, min: number | null, max: number | null): string {
    if (value === null || min === null || max === null || min === max) return '50%';
    return `${Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))}%`;
  }

  function comparisonWidth(
    start: number | null,
    end: number | null,
    min: number | null,
    max: number | null
  ): string {
    if (start === null || end === null || min === null || max === null || min === max) return '0%';
    return `${Math.max(0, Math.min(100, ((end - start) / (max - min)) * 100))}%`;
  }

  function percentileLabel(row: OfficialComparisonRow): string | null {
    if (row.percentile === null) return null;
    const rounded = Math.round(row.percentile);
    const lastTwo = rounded % 100;
    const suffix =
      lastTwo >= 11 && lastTwo <= 13
        ? 'th'
        : rounded % 10 === 1
          ? 'st'
          : rounded % 10 === 2
            ? 'nd'
            : rounded % 10 === 3
              ? 'rd'
              : 'th';
    return `Around the ${rounded}${suffix} percentile`;
  }

  function resetFilters(): void {
    search = '';
    setFilter = 'all';
    fighterFilter = 'all';
    attackFilter = 'all';
    moveFilter = 'all';
    healthFilter = 'all';
    eraFilter = 'all';
  }

  const filtersActive = $derived(
    Boolean(search.trim()) ||
      setFilter !== 'all' ||
      fighterFilter !== 'all' ||
      attackFilter !== 'all' ||
      moveFilter !== 'all' ||
      healthFilter !== 'all' ||
      eraFilter !== 'all'
  );
</script>

<div class="screen scroll-y">
  <header class="analysis-head">
    <div class="heading">
      <span class="eyebrow">Set tool</span>
      <h1>Analysis</h1>
      <p>See what is in a deck, then compare its shape with published official fighters.</p>
    </div>
    {#if subjectOptions.length > 0}
      <label class="subject-picker">
        <span>Character and action deck</span>
        <Select
          value={selectedCharacterId}
          options={subjectOptions}
          onchange={(id) => (selectedCharacterId = id)}
        />
      </label>
    {/if}
  </header>

  <main class="content">
    <section class="context-note" aria-label="How to read this analysis">
      <span class="note-icon"><Icon name="chart" size={18} /></span>
      <div>
        <strong>Context, not a balance verdict</strong>
        <p>
          Official ranges describe what has been published. Abilities, matchups and how cards
          work together can compensate dramatically for unusual raw numbers.
        </p>
      </div>
    </section>

    {#if subjects.length === 0}
      <section class="panel empty-panel">
        <EmptyState
          icon="card"
          title="No action deck to analyse"
          description="Add an action deck to a character and its statistics will appear here."
        />
      </section>
    {:else if analysis}
      <section class="subject-summary" aria-labelledby="selected-analysis-title">
        <div>
          <div class="summary-badges">
            <Badge colorVar={CHARACTER_ROLE_META[analysis.characterRole].colorVar}>
              {CHARACTER_ROLE_META[analysis.characterRole].label}
            </Badge>
            <span>{analysis.actionDeckCount} {analysis.actionDeckCount === 1 ? 'deck' : 'decks'}</span>
          </div>
          <h2 id="selected-analysis-title">{analysis.characterName || 'Untitled character'}</h2>
          <p>{deckNames.join(' · ')}</p>
        </div>
        <dl class="headline-stats">
          <div><dt>Card designs</dt><dd class="numeric">{analysis.designCount}</dd></div>
          <div><dt>Physical cards</dt><dd class="numeric">{analysis.copyCount}</dd></div>
          <div><dt>Fighter profiles</dt><dd class="numeric">{analysis.fighters.length}</dd></div>
        </dl>
      </section>

      <div class="analysis-grid">
        <section class="panel composition-panel" aria-labelledby="composition-title">
          <div class="panel-heading">
            <div><span class="eyebrow">Action deck</span><h2 id="composition-title">Deck composition</h2></div>
            <div class="coverage-notes">
              {#if analysis.unclassifiedCombat.copyCount > 0}
                <span class="coverage-note">{analysis.unclassifiedCombat.copyCount} unclassified</span>
              {/if}
              {#if analysis.unanalysedReplacements.copyCount > 0}
                <span class="coverage-note">
                  {analysis.unanalysedReplacements.copyCount}
                  {analysis.unanalysedReplacements.copyCount === 1 ? ' replacement not interpreted' : ' replacements not interpreted'}
                </span>
              {/if}
            </div>
          </div>

          {#if analysis.combatSupport === 'hero-symbols'}
            <div class="combat-grid">
              {#each COMBAT_SYMBOLS as symbol (symbol)}
                {@const summary = analysis.symbols[symbol]}
                {@const meta = COMBAT_META[symbol]}
                <article class="combat-card" style:--combat-color="var({meta.colorVar})">
                  <header><span class="combat-symbol">{meta.shortLabel}</span><strong>{meta.label}</strong></header>
                  <span class="combat-count numeric">{summary.copyCount}</span>
                  <span class="combat-caption">{countLabel(summary.designCount, summary.copyCount)}</span>
                  {#if summary.printedValue}
                    {#if symbol === 'attack' || symbol === 'defense'}
                      {@const capable = symbol === 'attack' ? analysis.attackCapable : analysis.defenseCapable}
                      <dl class="combat-values">
                        <div><dt>{meta.label} only</dt><dd class="numeric">{formatNumber(summary.printedValue.complete ? summary.printedValue.values.total : null, 0)}</dd></div>
                        <div><dt>With Versatile</dt><dd class="numeric">{formatNumber(capable.complete ? capable.values.total : null, 0)}</dd></div>
                      </dl>
                      {#if !summary.printedValue.complete || !capable.complete}
                        <small class="combat-coverage">{coverageLabel(capable.coverage)}</small>
                      {/if}
                    {:else}
                      <dl class="combat-values">
                        <div><dt>Average</dt><dd class="numeric">{formatNumber(summary.printedValue.complete ? summary.printedValue.values.average : null)}</dd></div>
                        <div><dt>Total</dt><dd class="numeric">{formatNumber(summary.printedValue.complete ? summary.printedValue.values.total : null, 0)}</dd></div>
                      </dl>
                      {#if !summary.printedValue.complete}
                        <small class="combat-coverage">{coverageLabel(summary.printedValue.coverage)}</small>
                      {/if}
                    {/if}
                  {:else}
                    <p class="no-value">No printed combat value</p>
                  {/if}
                </article>
              {/each}
            </div>

            <div class="value-grid">
              <article class="value-card">
                <span>Numeric boost average</span>
                <strong class="numeric">{formatNumber(analysis.boost.missing.copyCount === 0 ? analysis.boost.numeric.average : null)}</strong>
                <p>{formatNumber(analysis.boost.numeric.total, 0)} total · {analysis.boost.numeric.copyCount} numeric copies</p>
                {#if analysis.boost.customSymbol.copyCount > 0}
                  <small>{analysis.boost.customSymbol.copyCount} copies use custom symbols</small>
                {:else if !analysis.boost.complete}
                  <small>{coverageLabel(analysis.boost.coverage)}</small>
                {/if}
              </article>
            </div>
          {:else}
            <div class="unsupported-context">
              <Icon name="card" size={20} />
              <div>
                <strong>Combat-type breakdown is available for hero decks</strong>
                <p>Villain and minion cards print separate attack and defense fields, so they are not treated as hero Attack, Defense, Versatile and Scheme cards.</p>
              </div>
            </div>
            <article class="value-card boost-only">
              <span>Numeric boost average</span>
              <strong class="numeric">{formatNumber(analysis.boost.missing.copyCount === 0 ? analysis.boost.numeric.average : null)}</strong>
              <p>{formatNumber(analysis.boost.numeric.total, 0)} total across {analysis.boost.numeric.copyCount} numeric copies</p>
            </article>
          {/if}

          {#if analysis.ignoredCards.copyCount > 0}
            <p class="data-caveat">{analysis.ignoredCards.copyCount} non-action {analysis.ignoredCards.copyCount === 1 ? 'card was' : 'cards were'} ignored.</p>
          {/if}
          {#if analysis.unanalysedReplacements.copyCount > 0}
            <p class="data-caveat">Full-face replacements remain in the overall card totals, but their hidden card fields are not interpreted.</p>
          {/if}
        </section>

        <section class="panel fighter-panel" aria-labelledby="fighter-title">
          <div class="panel-heading"><div><span class="eyebrow">Character card</span><h2 id="fighter-title">Fighter profile</h2></div></div>
          <div class="fighter-list">
            {#each analysis.fighters as fighter, index (`${fighter.kind}:${fighter.id ?? index}`)}
              <article class="fighter-card">
                <header>
                  <div>
                    <span class="fighter-kind">{fighter.kind === 'primary' ? 'Primary' : fighter.kind === 'additional' ? 'Shared-deck identity' : 'Sidekick'}</span>
                    <h3>{fighter.name || 'Unnamed fighter'}</h3>
                  </div>
                  <Badge colorVar={fighter.kind === 'sidekick' ? '--role-sidekick' : CHARACTER_ROLE_META[analysis.characterRole].colorVar}>{ATTACK_TYPE_LABELS[fighter.attackType]}</Badge>
                </header>
                <dl>
                  <div><dt>{fighter.multiple ? 'Health each' : 'Health'}</dt><dd class="numeric">{fighter.health ?? '—'}</dd></div>
                  <div><dt>Move</dt><dd class="numeric">{fighter.move ?? '—'}</dd></div>
                  <div><dt>Figures</dt><dd class="numeric">{fighter.figureCount ?? 'Shared'}</dd></div>
                </dl>
              </article>
            {/each}
          </div>
          {#if analysis.ownerAccess}
            <div class="owner-block">
              <h3>Card access</h3>
              <div class="owner-list">
                <span><b>Shared</b><span class="numeric">{analysis.ownerAccess.shared.copyCount}</span></span>
                <span><b>Restricted</b><span class="numeric">{analysis.ownerAccess.restricted.copyCount}</span></span>
              </div>
              {#if analysis.ownerRestrictions.length > 1}
                <p>{analysis.ownerRestrictions.map((owner) => `${owner.label}: ${owner.copyCount}`).join(' · ')}</p>
              {/if}
            </div>
          {/if}
          {#if closestOfficialProfiles}
            <div class="profile-matches">
              <h3>Closest official stat profiles</h3>
              <p>Based on roster, range, health, Move, card-type quantities, printed Attack and Defense totals, and numeric boost—not ability text.</p>
              <div class="profile-match-list">
                {#each closestOfficialProfiles.matches as match, index (match.id)}
                  <span class:primary-match={index === 0}>
                    <strong>{match.name}</strong>
                    <small>{match.setName}</small>
                  </span>
                {/each}
              </div>
              <small>{closestOfficialProfiles.cohortLabel}{closestOfficialProfiles.cohortBroadened ? ' · broadened cohort' : ''}</small>
            </div>
          {/if}
        </section>
      </div>

      <section class="panel official-panel" aria-labelledby="official-context-title">
        <div class="panel-heading official-heading">
          <div>
            <span class="eyebrow">Published reference</span>
            <h2 id="official-context-title">Official context</h2>
            <p>
              Compared with all relevant official characters in the displayed cohort. Partial
              records are omitted; deck-value cohorts also omit choice pools and incomplete decks.
              Current deck totals are quantity-weighted by physical copies. Attack and Defense are
              shown both on their own and with Versatile cards included.
            </p>
          </div>
          <span class="catalogue-version">Catalogue {OFFICIAL_CATALOGUE_VERSION}</span>
        </div>

        {#if analysis.combatSupport !== 'hero-symbols'}
          <div class="unsupported-context compact-context">
            <Icon name="users" size={20} />
            <div>
              <strong>Official comparisons are available for heroes</strong>
              <p>The reference catalogue describes playable hero decks, not Adventures enemies. The raw totals above remain available.</p>
            </div>
          </div>
        {:else}
          <div class="comparison-grid">
            {#each officialComparisons as comparison (comparison.key)}
              <article
                class="comparison-card"
                class:unusual={comparison.band === 'unusual' || comparison.band === 'outside-observed-range'}
                class:unavailable={comparison.band === 'insufficient-data'}
                style:--marker={comparisonPosition(comparison.value, comparison.min, comparison.max)}
                style:--quartile-start={comparisonPosition(comparison.lowerQuartile, comparison.min, comparison.max)}
                style:--quartile-width={comparisonWidth(comparison.lowerQuartile, comparison.upperQuartile, comparison.min, comparison.max)}
                style:--median={comparisonPosition(comparison.median, comparison.min, comparison.max)}
              >
                <header><span>{comparison.label}</span><strong class="numeric">{comparison.formattedValue}</strong></header>
                <p class="comparison-statement">{comparison.statement}</p>
                {#if comparison.comparable}
                  <p class="comparable-stat">Comparable to <strong>{comparison.comparable.name}</strong> <span class="numeric">({comparison.comparable.formattedValue})</span></p>
                {/if}
                {#if percentileLabel(comparison)}<p class="percentile">{percentileLabel(comparison)}</p>{/if}
                {#if comparison.min !== null && comparison.max !== null}
                  <div class="range-plot" aria-hidden="true">
                    <span class="quartile-range"></span><span class="median-mark"></span>
                    {#if comparison.value !== null}<span class="value-mark"></span>{/if}
                  </div>
                  <div class="range-labels numeric"><span>{formatNumber(comparison.min)}</span><span>Median {formatNumber(comparison.median)}</span><span>{formatNumber(comparison.max)}</span></div>
                {/if}
                <footer>
                  <span>{comparison.cohortLabel}</span><span>{comparison.cohortSize} official characters</span>
                  {#if comparison.cohortBroadened}<span>Broadened cohort</span>{/if}
                </footer>
              </article>
            {/each}
          </div>
          {#if analysis.copyCount !== 30}
            <p class="deck-context-note">Deck-value comparisons appear once this action deck contains 30 physical cards. Fighter statistics remain comparable while the deck is in progress.</p>
          {/if}
        {/if}
      </section>
    {/if}

    {#if SHOW_OFFICIAL_CATALOGUE}
      <section class="panel catalogue-panel" aria-labelledby="catalogue-title">
      <div class="panel-heading catalogue-heading">
        <div><span class="eyebrow">Read-only reference</span><h2 id="catalogue-title">Official catalogue</h2><p>Explore the fighters behind the ranges without changing this set.</p></div>
        <span class="catalogue-count numeric">{filteredCatalogue.length} of {officialCatalogueRows.length} characters</span>
      </div>

      <div class="catalogue-controls">
        <label class="search-field"><span>Search</span><span class="search-input"><Icon name="search" size={14} /><TextInput bind:value={search} placeholder="Character, set or licence" /></span></label>
        <label><span>Set</span><Select value={setFilter} options={setOptions} onchange={(value) => (setFilter = value)} /></label>
        <label><span>Fighters</span><Select value={fighterFilter} options={fighterOptions} onchange={(value) => (fighterFilter = value)} /></label>
        <label><span>Range</span><Select value={attackFilter} options={attackOptions} onchange={(value) => (attackFilter = value)} /></label>
        <label><span>Move</span><Select value={moveFilter} options={moveOptions} onchange={(value) => (moveFilter = value)} /></label>
        <label><span>Health</span><Select value={healthFilter} options={healthOptions} onchange={(value) => (healthFilter = value)} /></label>
        <label><span>Release era</span><Select value={eraFilter} options={eraOptions} onchange={(value) => (eraFilter = value)} /></label>
      </div>

      {#if filtersActive}
        <div class="filter-summary"><span>Catalogue filters do not change the comparison cohorts above.</span><button type="button" onclick={resetFilters}>Clear filters</button></div>
      {/if}

      {#if filteredCatalogue.length === 0}
        <EmptyState compact icon="search" title="No official fighters match" description="Try clearing one or more catalogue filters." />
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard users need to pan the wide table) -->
        <div
          class="table-scroll"
          role="region"
          aria-label="Scrollable official catalogue results"
          tabindex="0"
        >
          <table>
            <caption class="sr-only">Sortable official character catalogue</caption>
            <thead><tr>
              <th aria-sort={sortKey === 'name' ? sortDirection : 'none'}><button type="button" onclick={() => pickSort('name')}>Character {#if sortKey === 'name'}<Icon name="chevronDown" size={12} />{/if}</button></th>
              <th aria-sort={sortKey === 'set' ? sortDirection : 'none'}><button type="button" onclick={() => pickSort('set')}>Set {#if sortKey === 'set'}<Icon name="chevronDown" size={12} />{/if}</button></th>
              <th aria-sort={sortKey === 'year' ? sortDirection : 'none'}><button type="button" onclick={() => pickSort('year')}>Year {#if sortKey === 'year'}<Icon name="chevronDown" size={12} />{/if}</button></th>
              <th aria-sort={sortKey === 'fighters' ? sortDirection : 'none'}><button type="button" onclick={() => pickSort('fighters')}>Fighters {#if sortKey === 'fighters'}<Icon name="chevronDown" size={12} />{/if}</button></th>
              <th aria-sort={sortKey === 'range' ? sortDirection : 'none'}><button type="button" onclick={() => pickSort('range')}>Range {#if sortKey === 'range'}<Icon name="chevronDown" size={12} />{/if}</button></th>
              <th aria-sort={sortKey === 'move' ? sortDirection : 'none'}><button type="button" onclick={() => pickSort('move')}>Move {#if sortKey === 'move'}<Icon name="chevronDown" size={12} />{/if}</button></th>
              <th aria-sort={sortKey === 'health' ? sortDirection : 'none'}><button type="button" onclick={() => pickSort('health')}>Health {#if sortKey === 'health'}<Icon name="chevronDown" size={12} />{/if}</button></th>
              <th>Coverage</th>
            </tr></thead>
            <tbody>
              {#each filteredCatalogue as row (row.id)}
                <tr>
                  <th scope="row"><strong>{row.name}</strong><span>{ROSTER_LABELS[row.rosterType]}</span></th>
                  <td><strong>{row.setName}</strong>{#if row.licence}<span>{row.licence}</span>{/if}</td>
                  <td class="numeric">{row.releaseYear}</td><td class="numeric">{fighterCountLabel(row)}</td>
                  <td>{row.primaryAttackType ? ATTACK_LABELS[row.primaryAttackType] : 'Unknown'}</td>
                  <td class="numeric">{row.move}</td><td class="numeric">{row.primaryHealth ?? '—'}</td>
                  <td class="coverage-cell">
                    <Badge colorVar={row.dataStatus === 'complete' ? '--success' : row.dataStatus === 'partial' ? '--warning' : '--info'}>{STATUS_LABELS[row.dataStatus]}</Badge>
                    {#if row.dataNote}
                      <details>
                        <summary>Caveat</summary>
                        <p>{row.dataNote}</p>
                      </details>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      </section>
    {/if}
  </main>
</div>

<style>
  .screen {
    min-height: 0;
    height: 100%;
    background: var(--surface-canvas);
  }

  .analysis-head {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    padding: var(--space-4) var(--space-8);
    border-bottom: 1px solid var(--border-subtle);
    background: color-mix(in oklab, var(--surface-base) 94%, transparent);
    backdrop-filter: blur(10px);
  }

  .heading h1,
  .subject-summary h2,
  .panel-heading h2 {
    margin: 0;
    font-family: var(--font-display);
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }

  .heading h1 {
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
  }

  .heading p,
  .panel-heading p,
  .subject-summary > div > p {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .subject-picker,
  .catalogue-controls label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 220px;
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    color: var(--text-tertiary);
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    width: min(100%, 1480px);
    margin-inline: auto;
    padding: var(--space-6) var(--space-8) var(--space-9);
  }

  .context-note {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border-accent);
    border-radius: var(--radius-md);
    background: var(--accent-soft);
    color: var(--text-secondary);
  }

  .context-note strong,
  .unsupported-context strong {
    display: block;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .context-note p,
  .unsupported-context p {
    margin: var(--space-1) 0 0;
    max-width: 82ch;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-tertiary);
  }

  .note-icon {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    flex: none;
    border-radius: var(--radius-sm);
    background: var(--surface-base);
    color: var(--text-accent);
  }

  .panel,
  .subject-summary {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: var(--surface-base);
    box-shadow: var(--shadow-sm);
  }

  .empty-panel {
    padding: var(--space-8);
  }

  .subject-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    padding: var(--space-5);
  }

  .subject-summary h2 {
    margin-top: var(--space-2);
    font-size: var(--text-2xl);
  }

  .summary-badges {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .headline-stats {
    display: flex;
    align-items: stretch;
    margin: 0;
  }

  .headline-stats div {
    display: flex;
    flex-direction: column-reverse;
    align-items: flex-end;
    justify-content: center;
    min-width: 104px;
    padding-inline: var(--space-4);
    border-left: 1px solid var(--border-subtle);
  }

  .headline-stats dt {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .headline-stats dd {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .analysis-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.65fr) minmax(300px, 1fr);
    align-items: start;
    gap: var(--space-5);
  }

  .composition-panel,
  .fighter-panel,
  .official-panel,
  .catalogue-panel {
    padding: var(--space-5);
  }

  .panel-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }

  .panel-heading h2 {
    margin-top: var(--space-1);
    font-size: var(--text-lg);
  }

  .coverage-note,
  .catalogue-version,
  .catalogue-count {
    flex: none;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    background: var(--surface-sunken);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .coverage-notes {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .combat-grid,
  .value-grid,
  .comparison-grid {
    display: grid;
    gap: var(--space-3);
  }

  .combat-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .comparison-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .value-grid {
    grid-template-columns: minmax(0, 260px);
    margin-top: var(--space-3);
  }

  .combat-card,
  .value-card,
  .fighter-card,
  .comparison-card {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
  }

  .combat-card {
    position: relative;
    overflow: hidden;
    padding: var(--space-3);
  }

  .combat-card::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: var(--combat-color);
  }

  .combat-card header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-secondary);
  }

  .combat-card header strong {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }

  .combat-symbol {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-xs);
    background: color-mix(in oklab, var(--combat-color) 18%, transparent);
    font-size: var(--text-2xs);
    font-weight: var(--weight-bold);
    color: var(--combat-color);
  }

  .combat-count {
    display: block;
    margin-top: var(--space-3);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
    color: var(--text-primary);
  }

  .combat-caption,
  .no-value,
  .combat-coverage,
  .value-card p,
  .value-card small,
  .data-caveat,
  .owner-block p {
    display: block;
    margin: var(--space-1) 0 0;
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .combat-values {
    display: flex;
    gap: var(--space-4);
    margin: var(--space-3) 0 0;
    padding-top: var(--space-2);
    border-top: 1px solid var(--border-subtle);
  }

  .combat-values div {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
  }

  .combat-values dt,
  .fighter-card dt {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .combat-values dd {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-secondary);
  }

  .value-card,
  .fighter-card,
  .comparison-card {
    padding: var(--space-3);
  }

  .value-card > span {
    display: block;
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    color: var(--text-tertiary);
  }

  .value-card > strong {
    display: block;
    margin-top: var(--space-1);
    font-size: var(--text-xl);
    color: var(--text-primary);
  }

  .value-card small,
  .combat-coverage,
  .data-caveat {
    color: var(--warning);
  }

  .boost-only {
    max-width: 280px;
    margin-top: var(--space-3);
  }

  .unsupported-context {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
    color: var(--text-muted);
  }

  .compact-context {
    max-width: 760px;
  }

  .fighter-list {
    display: grid;
    gap: var(--space-3);
  }

  .fighter-card header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .fighter-kind {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .fighter-card h3,
  .owner-block h3,
  .profile-matches h3 {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .fighter-card dl {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
    margin: var(--space-3) 0 0;
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
  }

  .fighter-card dl div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .fighter-card dd {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-secondary);
  }

  .owner-block,
  .profile-matches {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-subtle);
  }

  .profile-matches > p,
  .profile-matches > small {
    display: block;
    margin: var(--space-1) 0 0;
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
  }

  .profile-match-list {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .profile-match-list > span {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
  }

  .profile-match-list > span.primary-match {
    border-color: color-mix(in oklab, var(--accent) 35%, var(--border-subtle));
  }

  .profile-match-list strong {
    font-size: var(--text-xs);
    color: var(--text-primary);
  }

  .profile-match-list small {
    font-size: var(--text-2xs);
    text-align: right;
    color: var(--text-muted);
  }

  .owner-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .owner-list > span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .owner-list b {
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
  }

  .comparison-card {
    --comparison-accent: var(--accent);
    padding: var(--space-4);
  }

  .comparison-card.unusual {
    --comparison-accent: var(--warning);
    border-color: color-mix(in oklab, var(--warning) 40%, var(--border-subtle));
  }

  .comparison-card.unavailable {
    --comparison-accent: var(--text-muted);
  }

  .comparison-card header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .comparison-card header span {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-tertiary);
  }

  .comparison-card header strong {
    font-size: var(--text-xl);
    color: var(--text-primary);
  }

  .comparison-statement {
    margin: var(--space-3) 0 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--comparison-accent);
  }

  .percentile {
    margin: var(--space-1) 0 0;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .comparable-stat {
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .comparable-stat strong {
    color: var(--text-primary);
  }

  .comparable-stat span {
    color: var(--text-muted);
  }

  .deck-context-note {
    margin: var(--space-3) 0 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .range-plot {
    position: relative;
    height: 6px;
    margin-top: var(--space-4);
    border-radius: var(--radius-full);
    background: var(--surface-inset);
  }

  .quartile-range {
    position: absolute;
    inset-block: 0;
    left: var(--quartile-start);
    width: var(--quartile-width);
    border-radius: var(--radius-full);
    background: var(--accent-soft-hover);
  }

  .median-mark,
  .value-mark {
    position: absolute;
    top: 50%;
    translate: -50% -50%;
  }

  .median-mark {
    left: var(--median);
    width: 2px;
    height: 10px;
    background: var(--text-muted);
  }

  .value-mark {
    left: var(--marker);
    width: 10px;
    height: 10px;
    border: 2px solid var(--surface-raised);
    border-radius: var(--radius-full);
    background: var(--comparison-accent);
    box-shadow: var(--shadow-xs);
  }

  .range-labels {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    margin-top: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .comparison-card footer {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .comparison-card footer span + span::before {
    content: '·';
    margin-right: var(--space-2);
  }

  .catalogue-panel {
    margin-bottom: var(--space-4);
  }

  .catalogue-controls {
    display: grid;
    grid-template-columns: minmax(220px, 1.5fr) repeat(3, minmax(145px, 1fr));
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
  }

  .catalogue-controls label {
    min-width: 0;
  }

  .search-input {
    position: relative;
    display: block;
  }

  .search-input :global(.icon) {
    position: absolute;
    z-index: 1;
    top: 50%;
    left: var(--space-3);
    translate: 0 -50%;
    color: var(--text-muted);
    pointer-events: none;
  }

  .search-input :global(input) {
    padding-left: var(--space-8);
  }

  .filter-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-1);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .filter-summary button {
    flex: none;
    color: var(--text-accent);
    font-size: inherit;
    font-weight: var(--weight-medium);
  }

  .filter-summary button:hover {
    text-decoration: underline;
  }

  .table-scroll {
    margin-top: var(--space-4);
    overflow-x: auto;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
  }

  .table-scroll:focus-visible {
    outline: 0;
    box-shadow: var(--focus-ring);
  }

  table {
    width: 100%;
    min-width: 880px;
    border-collapse: collapse;
    font-size: var(--text-xs);
  }

  thead {
    background: var(--surface-sunken);
  }

  th,
  td {
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
    text-align: left;
    vertical-align: middle;
    color: var(--text-secondary);
  }

  thead th {
    padding-block: var(--space-2);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-wide);
    color: var(--text-muted);
  }

  thead button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: inherit;
    font: inherit;
  }

  thead [aria-sort='ascending'] :global(.icon) {
    rotate: 180deg;
  }

  tbody tr:last-child > * {
    border-bottom: 0;
  }

  tbody tr:hover {
    background: var(--surface-hover);
  }

  tbody th {
    font-weight: var(--weight-normal);
  }

  tbody th strong,
  tbody td strong {
    display: block;
    font-weight: var(--weight-medium);
    color: var(--text-primary);
  }

  tbody th span,
  tbody td span:not(.badge) {
    display: block;
    margin-top: var(--space-1);
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }

  .coverage-cell details {
    position: relative;
    margin-top: var(--space-1);
    color: var(--text-muted);
  }

  .coverage-cell summary {
    width: max-content;
    cursor: pointer;
    font-size: var(--text-2xs);
    color: var(--text-accent);
  }

  .coverage-cell details p {
    width: min(42ch, 60vw);
    margin: var(--space-2) 0 0;
    padding: var(--space-2);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-overlay);
    box-shadow: var(--shadow-md);
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--text-secondary);
  }

  @container home (max-width: 1050px) {
    .analysis-grid {
      grid-template-columns: 1fr;
    }

    .comparison-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .catalogue-controls {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .search-field {
      grid-column: span 2;
    }
  }

  @container home (max-width: 720px) {
    .analysis-head {
      position: static;
      align-items: stretch;
      flex-direction: column;
      gap: var(--space-3);
      padding: var(--space-4);
    }

    .subject-picker {
      min-width: 0;
    }

    .content {
      padding: var(--space-4);
    }

    .subject-summary {
      align-items: stretch;
      flex-direction: column;
    }

    .headline-stats {
      padding-top: var(--space-3);
      border-top: 1px solid var(--border-subtle);
    }

    .headline-stats div {
      flex: 1 1 0;
      align-items: flex-start;
      min-width: 0;
      padding-inline: var(--space-3);
    }

    .headline-stats div:first-child {
      padding-left: 0;
      border-left: 0;
    }

    .combat-grid,
    .comparison-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .catalogue-controls {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .search-field {
      grid-column: 1 / -1;
    }
  }

  @container home (max-width: 460px) {
    .content {
      gap: var(--space-4);
      padding: var(--space-3);
    }

    .composition-panel,
    .fighter-panel,
    .official-panel,
    .catalogue-panel {
      padding: var(--space-4);
    }

    .combat-grid,
    .value-grid,
    .comparison-grid,
    .catalogue-controls {
      grid-template-columns: 1fr;
    }

    .panel-heading,
    .filter-summary {
      align-items: flex-start;
      flex-direction: column;
    }

    .headline-stats {
      flex-wrap: wrap;
    }
  }
</style>
