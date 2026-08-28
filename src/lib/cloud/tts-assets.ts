/**
 * Permanent public hosting for one Tabletop Simulator export's generated files.
 *
 * The local document never receives these URLs. They belong only to the saved
 * object handed to TTS, preserving both offline authoring and the DOM/canvas
 * export pipeline's requirement that artwork remain embedded locally.
 */
import type {
  TtsHostedAsset,
  TtsOnlineAssetHost,
  TtsUploadProgress,
  TtsUploadResult
} from '$lib/export/tts-bundle';
import { auth } from './auth.svelte';
import { cloudConfig, TTS_ASSET_BUCKET } from './config';
import { CloudError, CloudNotConfiguredError, request } from './http';

/** Enough parallelism to avoid serial round trips without flooding Storage. */
const UPLOAD_CONCURRENCY = 4;

function encodedPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function publicPrefix(ownerId: string, setId: string): string {
  const config = cloudConfig();
  if (!config) throw new CloudNotConfiguredError();
  return (
    `${config.url}/storage/v1/object/public/${TTS_ASSET_BUCKET}/` +
    `${encodedPath(ownerId)}/${encodedPath(setId)}/`
  );
}

/**
 * A public HEAD carries no session token, deliberately. These URLs have to work
 * for every other person at the TTS table, and a stale author session must not
 * be capable of making an otherwise-public existence check fail.
 */
async function alreadyHosted(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (response.ok) return true;
    if (response.status === 404) return false;
  } catch {
    // Some proxies reject HEAD even while ordinary Storage uploads work. The
    // upsert below is safe, so inability to optimise must not block exporting.
  }
  return false;
}

async function uploadAsset(path: string, asset: TtsHostedAsset): Promise<void> {
  await request<void>(`/storage/v1/object/${TTS_ASSET_BUCKET}/${encodedPath(path)}`, {
    method: 'POST',
    headers: {
      'Content-Type': asset.contentType,
      'cache-control': '31536000',
      // Every URL contains the file's content hash. A same-path write is the
      // same bytes, and an upsert closes the small race between HEAD and POST.
      'x-upsert': 'true'
    },
    raw: new Blob([new Uint8Array(asset.bytes)], { type: asset.contentType })
  });
}

/**
 * Establish the identity Storage policies need and return the deterministic
 * host the exporter can use while it builds its object graph.
 *
 * Checking "Host assets online" is the author's explicit sharing choice, so a
 * throwaway identity is created without a second modal when they have not
 * signed in. The export panel explains that this identity belongs to the
 * current browser and offers the ordinary account controls elsewhere.
 */
export async function createTtsAssetHost(setId: string): Promise<TtsOnlineAssetHost> {
  if (!auth.signedIn) await auth.signInAnonymously();
  await auth.ensureFresh();

  const owner = auth.user;
  if (!owner) throw new CloudError('Could not establish an identity for online hosting.', 401);

  const ownerRoot = `${owner.id}/${setId}`;
  const prefix = publicPrefix(owner.id, setId);

  return {
    urlFor: (relativePath) => `${prefix}${encodedPath(relativePath)}`,
    async upload(
      assets: readonly TtsHostedAsset[],
      onProgress?: (progress: TtsUploadProgress) => void
    ): Promise<TtsUploadResult> {
      let cursor = 0;
      let done = 0;
      let uploaded = 0;
      let reused = 0;
      const failures: Array<{ cause: unknown }> = [];
      onProgress?.({ done: 0, total: assets.length, uploaded, reused });

      async function worker(): Promise<void> {
        for (;;) {
          /* Let uploads already in flight finish, but do not start more after
             one has failed. Waiting for every worker keeps a retry from racing
             work the rejected export left behind. */
          if (failures.length > 0) return;
          const index = cursor++;
          const asset = assets[index];
          if (!asset) return;

          try {
            const publicUrl = `${prefix}${encodedPath(asset.path)}`;
            if (await alreadyHosted(publicUrl)) {
              reused += 1;
            } else {
              await uploadAsset(`${ownerRoot}/${asset.path}`, asset);
              uploaded += 1;
            }
          } catch (cause) {
            if (failures.length === 0) failures.push({ cause });
            return;
          }

          done += 1;
          onProgress?.({ done, total: assets.length, uploaded, reused });
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, assets.length) }, () => worker())
      );
      const failure = failures[0];
      if (failure) throw failure.cause;
      return { uploaded, reused };
    }
  };
}
