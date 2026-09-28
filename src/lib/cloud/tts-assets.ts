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

export interface TtsPublishedSource {
  id: string;
  revision: number;
}

interface TtsRetentionRow {
  retention: 'published-current' | 'temporary';
}

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


type Registrar = (paths: string[], savePath: string | null) => Promise<TtsUploadResult['retention']>;

/**
 * Establish the identity Storage policies need and return the deterministic
 * host the exporter can use while it builds its object graph.
 *
 * Checking "Host assets online" is the author's explicit sharing choice, so a
 * throwaway identity is created without a second modal when they have not
 * signed in. The export panel explains that this identity belongs to the
 * current browser and offers the ordinary account controls elsewhere.
 */
async function hostFor(
  setId: string,
  register: (ownerRoot: string) => Registrar
): Promise<TtsOnlineAssetHost> {
  if (!auth.signedIn) await auth.signInAnonymously();
  await auth.ensureFresh();

  const owner = auth.user;
  if (!owner) throw new CloudError('Could not establish an identity for online hosting.', 401);

  const ownerRoot = `${owner.id}/${setId}`;
  const prefix = publicPrefix(owner.id, setId);
  const registrar = register(ownerRoot);

  return {
    urlFor: (relativePath) => `${prefix}${encodedPath(relativePath)}`,
    async upload(
      assets: readonly TtsHostedAsset[],
      onProgress?: (progress: TtsUploadProgress) => void,
      savePath?: string
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

      /* Uploading first keeps a registered manifest from ever naming a missing
         object. A failure here leaves harmless, unregistered objects that the
         ordinary candidate scan can reclaim after seven days. */
      const retention = await registrar(
        assets.map((asset) => `${ownerRoot}/${asset.path}`),
        savePath ? `${ownerRoot}/${savePath}` : null
      );
      return { uploaded, reused, retention };
    }
  };
}

async function registerManifest(
  setId: string,
  paths: string[],
  savePath: string | null,
  publishedSource: TtsPublishedSource | null
): Promise<'published-current' | 'temporary'> {
  const rows = await request<TtsRetentionRow[]>('/rest/v1/rpc/register_tts_export', {
    method: 'POST',
    body: {
      p_source_key: setId,
      p_asset_paths: paths,
      p_published_set_id: publishedSource?.id ?? null,
      p_published_revision: publishedSource?.revision ?? null,
      p_save_path: savePath
    }
  });
  const retention = rows[0]?.retention;
  if (retention !== 'published-current' && retention !== 'temporary') {
    throw new CloudError('The hosted export did not receive a retention policy.', 0);
  }
  return retention;
}

/**
 * A host that registers its manifest the moment its files are up.
 *
 * `publishedSource` asks for the export to become that revision's shared copy.
 * The server grants it only to the row's owner or an administrator, and only
 * while that revision has none; anything else is registered as temporary.
 */
export function createTtsAssetHost(
  setId: string,
  publishedSource: TtsPublishedSource | null = null
): Promise<TtsOnlineAssetHost> {
  return hostFor(setId, () => (paths, savePath) =>
    registerManifest(setId, paths, savePath, publishedSource)
  );
}

export interface DeferredTtsAssetHost {
  host: TtsOnlineAssetHost;
  /** Register what `host.upload` put online, once the published row exists. */
  register(publishedSource: TtsPublishedSource): Promise<'published-current' | 'temporary'>;
}

/**
 * A host whose manifest waits for a published row that does not exist yet.
 *
 * Publishing renders and uploads the shared copy *before* writing the row,
 * the same order card previews use, so a failed export fails the publish
 * rather than putting a revision online with no copy for visitors. But the
 * server can only accept a manifest as a revision's shared copy once that
 * revision exists, so registration is the one step left for afterwards.
 */
export async function createDeferredTtsAssetHost(setId: string): Promise<DeferredTtsAssetHost> {
  let manifest: { paths: string[]; savePath: string | null } | null = null;
  const host = await hostFor(setId, () => async (paths, savePath) => {
    manifest = { paths, savePath };
    return null;
  });

  return {
    host,
    register(publishedSource) {
      if (!manifest) throw new CloudError('Nothing was uploaded to register.', 0);
      return registerManifest(setId, manifest.paths, manifest.savePath, publishedSource);
    }
  };
}

export interface SharedTtsSave {
  /** The published revision the save belongs to. */
  revision: number;
  blob: Blob;
}

/**
 * The shared saved object for a published row's current revision, if it has
 * one — so a visitor downloads the copy everyone shares rather than rendering
 * and uploading their own, which would expire and cost storage per visitor.
 *
 * Anonymous, like every published read: a stale session must not be able to
 * make this fail for its own owner (see `listPublicSets`).
 */
export async function fetchSharedTtsSave(publishedSetId: string): Promise<SharedTtsSave | null> {
  const config = cloudConfig();
  if (!config) return null;

  const rows = await request<Array<{ save_path: string; revision: number }>>(
    '/rest/v1/rpc/published_tts_save',
    { method: 'POST', body: { p_set_id: publishedSetId }, anonymous: true }
  );
  const row = rows[0];
  if (!row) return null;

  const response = await fetch(
    `${config.url}/storage/v1/object/public/${TTS_ASSET_BUCKET}/${encodedPath(row.save_path)}`
  );
  if (!response.ok) {
    throw new CloudError('Could not download the shared Tabletop Simulator save.', response.status);
  }
  return {
    revision: row.revision,
    blob: new Blob([await response.text()], { type: 'application/json' })
  };
}
