/** Runs expensive publication and cloud hashes away from the editor's UI thread. */
import type { AdventureSet } from '$lib/sets/types';
import {
  prepareDraftSave,
  type DraftPreparationRequest,
  type DraftPreparationResponse,
  type PreparedDraftSave
} from './prepare-save';

export class SupersededDraftPreparation extends Error {
  constructor() {
    super('A newer draft generation replaced this preparation.');
    this.name = 'SupersededDraftPreparation';
  }
}

interface ActivePreparation {
  id: number;
  reject: (cause: unknown) => void;
  resolve: (prepared: PreparedDraftSave) => void;
}

export class DraftSavePreparer {
  #active: ActivePreparation | null = null;
  #nextId = 0;
  #worker: Worker | null = null;

  prepare(set: AdventureSet): Promise<PreparedDraftSave> {
    if (typeof Worker === 'undefined') return prepareDraftSave(set);

    this.supersede();

    const id = ++this.#nextId;
    const worker = this.#worker ?? this.#createWorker();
    this.#worker = worker;

    return new Promise<PreparedDraftSave>((resolve, reject) => {
      this.#active = { id, resolve, reject };
      worker.postMessage({ id, set } satisfies DraftPreparationRequest);
    });
  }

  supersede(): void {
    if (!this.#active) return;
    this.#active.reject(new SupersededDraftPreparation());
    this.#worker?.terminate();
    this.#worker = null;
    this.#active = null;
  }

  destroy(): void {
    this.supersede();
    this.#worker?.terminate();
    this.#worker = null;
  }

  #createWorker(): Worker {
    const worker = new Worker(new URL('./prepare-save.worker.ts', import.meta.url), {
      type: 'module'
    });
    worker.onmessage = (event: MessageEvent<DraftPreparationResponse>): void => {
      const active = this.#active;
      if (!active || event.data.id !== active.id) return;
      this.#active = null;
      if (event.data.ok) active.resolve(event.data.prepared);
      else active.reject(new Error(event.data.message));
    };
    worker.onerror = (): void => {
      const active = this.#active;
      this.#active = null;
      this.#worker?.terminate();
      this.#worker = null;
      active?.reject(new Error('The browser could not prepare the draft in the background.'));
    };
    worker.onmessageerror = (): void => {
      const active = this.#active;
      this.#active = null;
      this.#worker?.terminate();
      this.#worker = null;
      active?.reject(new Error('The browser could not read the prepared draft.'));
    };
    return worker;
  }
}
