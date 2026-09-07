import { mount } from 'svelte';
import '../src/styles/index.css';
import DraftConflictDialog from '../src/lib/components/cloud/DraftConflictDialog.svelte';
import { asId, asIsoDateTime } from '../src/lib/core/id';
import { persistenceCoordinator } from '../src/lib/persistence/coordinator.svelte';
import { createEmptySet } from '../src/lib/sets/factory';
import type { SetId } from '../src/lib/sets/types';
import { workshop } from '../src/lib/state/workshop.svelte';

const target = document.querySelector<HTMLElement>('#preview-root');
if (!target) throw new Error('Conflict preview root is missing.');

const id = asId<SetId>('set_phase5_dialog_preview');
const fixture = {
  ...createEmptySet({ name: 'Clockwork Keep', kind: 'adventure' }),
  id
};
fixture.meta.updatedAt = asIsoDateTime('2026-09-02T16:30:00.000Z');
workshop.load(fixture);
persistenceCoordinator.status = {
  kind: 'conflict',
  attempt: 0,
  message: 'Cloud changed in another browser; automatic saving is paused.'
};
persistenceCoordinator.conflict = { localId: id, baseRevision: 4, remoteRevision: 6 };

mount(DraftConflictDialog, { target });
