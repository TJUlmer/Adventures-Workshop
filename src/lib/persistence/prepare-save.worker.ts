import {
  prepareDraftSave,
  type DraftPreparationRequest,
  type DraftPreparationResponse
} from './prepare-save';

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<DraftPreparationRequest>) => void) | null;
  postMessage(message: DraftPreparationResponse): void;
};

workerScope.onmessage = (event): void => {
  const { id, set } = event.data;
  void prepareDraftSave(set).then(
    (prepared) => workerScope.postMessage({ id, ok: true, prepared }),
    (cause) =>
      workerScope.postMessage({
        id,
        ok: false,
        message: cause instanceof Error ? cause.message : 'Draft preparation failed.'
      })
  );
};
