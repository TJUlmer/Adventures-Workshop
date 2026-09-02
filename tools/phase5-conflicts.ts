import type { DraftSummary, LoadedDraft } from '../src/lib/cloud/drafts';
import type { DraftTransferOptions } from '../src/lib/cloud/drafts';
import { createCard } from '../src/lib/cards/factory';
import { createCharacter } from '../src/lib/characters/factory';
import { asId, asIsoDateTime } from '../src/lib/core/id';
import { createActionDeck } from '../src/lib/decks/factory';
import { createConflictCopy } from '../src/lib/persistence/conflicts';
import {
  draftContentHash,
  PersistenceCoordinator
} from '../src/lib/persistence/coordinator.svelte';
import type { CachedDraftState } from '../src/lib/persistence/types';
import { createEmptySet } from '../src/lib/sets/factory';
import { forkSet } from '../src/lib/sets/fork';
import type { AdventureSet, SetId } from '../src/lib/sets/types';
import {
  loadSet,
  purgeSet,
  readDraftState,
  readIndex,
  saveSetWithDraftState
} from '../src/lib/storage/library';

const status = document.querySelector<HTMLParagraphElement>('#status');
const checks = document.querySelector<HTMLUListElement>('#checks');
if (!status || !checks) throw new Error('Verification page is incomplete.');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function addCheck(message: string): void {
  const item = document.createElement('li');
  item.textContent = message;
  checks.append(item);
}

function summary(set: AdventureSet, revision: number): DraftSummary {
  return {
    id: `draft-${set.id}`,
    localId: set.id,
    name: set.name,
    subtitle: set.subtitle,
    kind: set.kind,
    cardCount: set.cards.length,
    characterCount: set.characters.length,
    characters: [],
    blockers: 0,
    gaps: 0,
    issueCount: 0,
    origin: null,
    documentUpdatedAt: set.meta.updatedAt,
    schemaVersion: set.schemaVersion,
    revision,
    deletedAt: null,
    createdAt: '2026-09-02T12:00:00.000Z',
    updatedAt: '2026-09-02T12:00:00.000Z'
  };
}

function loaded(set: AdventureSet, revision: number): LoadedDraft {
  return { set, summary: summary(set, revision), assetPaths: [] };
}

async function seed(set: AdventureSet, revision = 1): Promise<void> {
  const state: CachedDraftState = {
    localId: set.id,
    cloudRevision: revision,
    // Pending means the cached document differs from the last acknowledged
    // generation; keeping the two hashes equal would be an impossible state.
    syncedHash: `acknowledged-before-${await draftContentHash(set)}`,
    pending: true,
    lastCloudSaveAt: asIsoDateTime('2026-09-02T12:00:00.000Z'),
    assetPaths: [],
    cloudDraft: true
  };
  assert(await saveSetWithDraftState(set, state), 'Could not seed the local conflict fixture.');
}

function fixture(label: string): { local: AdventureSet; remote: AdventureSet } {
  const id = asId<SetId>(`set_phase5_${label}_${crypto.randomUUID()}`);
  const local = createEmptySet({ name: `${label} device`, kind: 'heroes' });
  const remote = structuredClone(local);
  return {
    local: { ...local, id },
    remote: {
      ...remote,
      id,
      name: `${label} cloud`,
      meta: { ...remote.meta, updatedAt: asIsoDateTime('2026-09-02T13:00:00.000Z') }
    }
  };
}

const created: SetId[] = [];

async function removeProbeFixtures(ids?: readonly SetId[]): Promise<void> {
  const targets =
    ids ??
    (await readIndex()).map((entry) => entry.id).filter((id) => id.startsWith('set_phase5_'));
  // `purgeSet` rewrites one shared index, so these must not race each other.
  for (const id of targets) await purgeSet(id);
}

try {
  await removeProbeFixtures();
  const cloudChoice = fixture('cloud-choice');
  created.push(cloudChoice.local.id);
  await seed(cloudChoice.local);
  const cloudCoordinator = new PersistenceCoordinator({
    hasPermanentSession: () => true,
    isOnline: () => true,
    fetchDraftSummary: async () => summary(cloudChoice.remote, 2),
    fetchDraft: async () => loaded(cloudChoice.remote, 2)
  });
  const openedCloud = await cloudCoordinator.open(cloudChoice.local.id);
  assert(openedCloud?.conflict !== null, 'A stale pending cache did not stop as a conflict.');
  await cloudCoordinator.resolveConflictWithCloud(cloudChoice.local.id);
  const cloudCache = await loadSet(cloudChoice.local.id);
  const cloudState = await readDraftState(cloudChoice.local.id);
  assert(cloudCache?.name === cloudChoice.remote.name, 'The confirmed cloud version was not cached.');
  assert(cloudState?.cloudRevision === 2 && !cloudState.pending, 'Cloud acknowledgement is not clean.');
  addCheck('Use cloud version replaces the cache only after complete hydration.');

  const localChoice = fixture('local-choice');
  created.push(localChoice.local.id);
  await seed(localChoice.local);
  let expectedRevision: number | null | undefined;
  const localCoordinator = new PersistenceCoordinator({
    hasPermanentSession: () => true,
    isOnline: () => true,
    fetchDraftSummary: async () => summary(localChoice.remote, 2),
    saveDraft: async (
      set: AdventureSet,
      expected: number | null,
      options: DraftTransferOptions = {}
    ) => {
      expectedRevision = expected;
      await options.onAssetsReady?.([]);
      return {
        outcome: 'saved',
        draftId: `draft-${set.id}`,
        revision: 3,
        documentUpdatedAt: set.meta.updatedAt,
        updatedAt: '2026-09-02T14:00:00.000Z',
        deletedAt: null,
        assetPaths: []
      };
    }
  });
  const openedLocal = await localCoordinator.open(localChoice.local.id);
  assert(openedLocal?.conflict !== null, 'The local-choice fixture did not enter conflict.');
  await localCoordinator.resolveConflictWithLocal(localChoice.local);
  const localState = await readDraftState(localChoice.local.id);
  assert(expectedRevision === 2, 'The device choice did not use the known remote revision.');
  assert(localState?.cloudRevision === 3 && !localState.pending, 'The device choice was not acknowledged.');
  addCheck('Keep this device’s version advances exactly the known online revision.');

  const movedAgain = fixture('moved-again');
  created.push(movedAgain.local.id);
  await seed(movedAgain.local);
  const movedAgainCoordinator = new PersistenceCoordinator({
    hasPermanentSession: () => true,
    isOnline: () => true,
    fetchDraftSummary: async () => summary(movedAgain.remote, 2),
    saveDraft: async () => ({
      outcome: 'conflict',
      draftId: `draft-${movedAgain.local.id}`,
      revision: 3,
      documentUpdatedAt: movedAgain.remote.meta.updatedAt,
      updatedAt: '2026-09-02T14:00:00.000Z',
      deletedAt: null
    })
  });
  await movedAgainCoordinator.open(movedAgain.local.id);
  await movedAgainCoordinator.resolveConflictWithLocal(movedAgain.local);
  assert(
    movedAgainCoordinator.conflict?.remoteRevision === 3,
    'A second remote advance did not stop the explicit overwrite safely.'
  );
  addCheck('A newer race stops again instead of silently overwriting another browser.');

  const backgroundOriginal = fixture('background-original');
  created.push(backgroundOriginal.local.id);
  await seed(backgroundOriginal.local);
  const backgroundCoordinator = new PersistenceCoordinator({
    hasPermanentSession: () => true,
    isOnline: () => true,
    fetchDraftSummary: async () => summary(backgroundOriginal.remote, 2),
    saveDraft: async (
      set: AdventureSet,
      _expected: number | null,
      options: DraftTransferOptions = {}
    ) => {
      await options.onAssetsReady?.([]);
      return {
        outcome: 'saved',
        draftId: `draft-${set.id}`,
        revision: 1,
        documentUpdatedAt: set.meta.updatedAt,
        updatedAt: '2026-09-02T14:00:00.000Z',
        deletedAt: null,
        assetPaths: []
      };
    }
  });
  await backgroundCoordinator.open(backgroundOriginal.local.id);
  const backgroundCopy = createConflictCopy(backgroundOriginal.local);
  created.push(backgroundCopy.id);
  await saveSetWithDraftState(backgroundCopy, {
    localId: backgroundCopy.id,
    cloudRevision: null,
    syncedHash: null,
    pending: false,
    lastCloudSaveAt: null,
    assetPaths: [],
    cloudDraft: true
  });
  await backgroundCoordinator.flush(backgroundCopy, undefined, false);
  assert(
    backgroundCoordinator.activeSetId === backgroundOriginal.local.id &&
      backgroundCoordinator.conflict?.localId === backgroundOriginal.local.id,
    'Uploading the conflict copy hid or resumed the original conflict.'
  );
  addCheck('Uploading a conflict copy keeps the original conflict visible and stopped.');

  const copySource = fixture('both').local;
  const copyId = asId<SetId>(`set_phase5_copy_${crypto.randomUUID()}`);
  const copy = createConflictCopy(copySource, copyId);
  assert(copy.id === copyId && copy.id !== copySource.id, 'Keep both did not create a new set identity.');
  assert(copy.name.endsWith('(conflict copy)'), 'The conflict copy is not visibly distinguished.');
  assert(
    copy.characters.map((entry) => entry.id).join() ===
      copySource.characters.map((entry) => entry.id).join() &&
      copy.cards.map((entry) => entry.id).join() === copySource.cards.map((entry) => entry.id).join(),
    'Keep both rewrote internal entity identities.'
  );
  addCheck('Keep both changes only the set identity and preserves internal references.');

  const published = createEmptySet({ name: 'Published source', kind: 'heroes' });
  const hero = createCharacter('hero', { name: 'Identity Keeper' });
  const deck = createActionDeck(hero.id);
  const card = createCard('action', deck.id, { name: 'Same Card' });
  published.characters.push(hero);
  published.decks.push(deck);
  published.cards.push(card);
  const fork = forkSet(published, {
    slug: 'published-source',
    id: 'published-row-id',
    revision: 7,
    authorName: 'Original Author'
  });
  assert(fork.id !== published.id, 'Forking reused the published set identity.');
  assert(fork.characters[0]?.id === hero.id, 'Forking changed the character identity.');
  assert(fork.decks[0]?.id === deck.id, 'Forking changed the deck identity.');
  assert(fork.cards[0]?.id === card.id, 'Forking changed the card identity.');
  assert(
    fork.origin?.setId === 'published-row-id' && fork.origin.revision === 7,
    'Forking did not preserve its published origin.'
  );
  addCheck('Forking creates a new draft identity while retaining entities and published origin.');

  status.textContent = 'PASS — Phase 5 conflict decisions are revision-safe.';
} catch (cause) {
  status.textContent = `FAIL — ${cause instanceof Error ? cause.message : 'Unknown error'}`;
  throw cause;
} finally {
  await removeProbeFixtures(created);
}
