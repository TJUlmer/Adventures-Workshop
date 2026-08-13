/**
 * Offering changes back, over the wire.
 *
 * `sets/contribution.ts` decides *what* is being offered; this decides how it
 * travels. The two are split for the same reason the exporters are split from
 * the renderer — the change set is pure and testable against a document, and
 * nothing in it should know about HTTP.
 *
 * Artwork is lifted into Storage on the way out and re-embedded on the way in,
 * exactly as publishing does. An offer that carried its pictures as data URLs
 * would put megabytes into a row that gets listed, and the owner would download
 * all of it just to see that four cards changed.
 */
import type { ChangeEntry } from '$lib/sets/contribution';
import {
  collectEmbeddedAssets,
  collectPublishedAssets,
  substituteStrings,
  toDataUrl
} from './assets';
import { auth } from './auth.svelte';
import { CloudError, request, requestBlob } from './http';
import { assetPrefix, uploadAsset } from './sets';

export type ContributionStatus = 'open' | 'accepted' | 'declined' | 'withdrawn';

/** A contribution as a list wants it — without the payload. */
export interface ContributionSummary {
  id: string;
  set_id: string;
  contributor_id: string;
  base_revision: number;
  title: string;
  message: string;
  entry_count: number;
  status: ContributionStatus;
  applied_keys: string[];
  resolution_note: string;
  created_at: string;
  resolved_at: string | null;
  /** Embedded through `contributor_id → profiles`, like a gallery tile's author. */
  contributor: { display_name: string; avatar_url: string } | null;
}

/** The same, opened. Only ever fetched one at a time. */
export interface Contribution extends ContributionSummary {
  payload: { entries: ChangeEntry[] };
}

/** Columns for a list. Never `payload` — that is the whole point of them. */
const SUMMARY_COLUMNS =
  'id,set_id,contributor_id,base_revision,title,message,entry_count,status,' +
  'applied_keys,resolution_note,created_at,resolved_at,' +
  'contributor:profiles(display_name,avatar_url)';

export interface OfferOptions {
  title?: string;
  message?: string;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Offer a change set to the set it was copied from.
 *
 * `setId` is the *published row* the fork recorded in `set.origin`, not a local
 * id. `localSetId` is only used to name the uploaded assets, so a contributor's
 * pictures land under a path they own and are findable later.
 */
export async function offerContribution(
  setId: string,
  localSetId: string,
  baseRevision: number,
  entries: readonly ChangeEntry[],
  options: OfferOptions = {}
): Promise<ContributionSummary> {
  await auth.ensureFresh();
  const user = auth.user;
  if (!user) throw new CloudError('Sign in to offer your changes.', 401);
  if (entries.length === 0) throw new CloudError('There is nothing to offer.', 0);

  /*
   * Round-tripped through JSON before anything else touches it. The entries
   * hold live document objects, which under Svelte are `$state` proxies —
   * `collectEmbeddedAssets` walks them and `structuredClone` would throw. This
   * is also the point at which the payload stops being anything but data.
   */
  const plain: { entries: ChangeEntry[] } = JSON.parse(JSON.stringify({ entries }));

  const assets = await collectEmbeddedAssets(plain);
  options.onProgress?.(0, assets.length);

  const mapping = new Map<string, string>();
  for (const [index, asset] of assets.entries()) {
    mapping.set(asset.dataUrl, await uploadAsset(asset, user.id, localSetId));
    options.onProgress?.(index + 1, assets.length);
  }

  const payload = substituteStrings(plain, mapping);

  const [created] = await request<ContributionSummary[]>(
    `/rest/v1/set_contributions?select=${SUMMARY_COLUMNS}`,
    {
      method: 'POST',
      /* `contributor_id` is deliberately absent: the column defaults to
         `auth.uid()` and is not in the insert grant, so who offered it comes
         from the token and cannot be claimed by the request. */
      body: {
        set_id: setId,
        base_revision: baseRevision,
        title: (options.title ?? '').trim().slice(0, 120),
        message: (options.message ?? '').trim().slice(0, 2000),
        payload,
        entry_count: entries.length
      },
      headers: { Prefer: 'return=representation' }
    }
  );

  if (!created) throw new CloudError('The server accepted the offer but returned nothing.', 0);
  return created;
}

/**
 * Contributions to one set.
 *
 * Readable by the set's owner and by each contributor for their own — the
 * policy decides, so this cannot widen it by asking wrongly. Open first, then
 * newest: an owner opening this screen is here to deal with what is waiting.
 */
export async function listContributions(
  setId: string,
  status: ContributionStatus | 'all' = 'all'
): Promise<ContributionSummary[]> {
  await auth.ensureFresh();
  const filter = status === 'all' ? '' : `&status=eq.${status}`;
  return request<ContributionSummary[]>(
    `/rest/v1/set_contributions?select=${SUMMARY_COLUMNS}` +
      `&set_id=eq.${encodeURIComponent(setId)}${filter}` +
      '&order=status.asc,created_at.desc'
  );
}

/** Everything this person has offered to anyone, for their own shelf. */
export async function listMyContributions(): Promise<ContributionSummary[]> {
  await auth.ensureFresh();
  const user = auth.user;
  if (!user) return [];
  return request<ContributionSummary[]>(
    `/rest/v1/set_contributions?select=${SUMMARY_COLUMNS}` +
      `&contributor_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc`
  );
}

/**
 * One contribution, with its payload, artwork re-embedded.
 *
 * The re-embedding matters as much here as it does for a published set: an
 * entry still pointing at a Storage URL would apply into the owner's document
 * as a remote reference, which breaks offline and taints the canvas in
 * `card-image.ts` — so PNG export would fail somewhere a long way from the
 * cause.
 */
export async function fetchContribution(
  id: string,
  onProgress?: (done: number, total: number) => void
): Promise<Contribution | null> {
  await auth.ensureFresh();
  const rows = await request<Contribution[]>(
    `/rest/v1/set_contributions?select=${SUMMARY_COLUMNS},payload` +
      `&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  const row = rows[0];
  if (!row) return null;

  const prefix = assetPrefix();
  const urls = prefix ? collectPublishedAssets(row.payload, prefix) : [];
  const mapping = new Map<string, string>();

  onProgress?.(0, urls.length);
  for (const [index, url] of urls.entries()) {
    try {
      const blob = await requestBlob(url);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      mapping.set(url, toDataUrl(blob.type || 'application/octet-stream', bytes));
    } catch {
      // One missing picture must not cost the whole offer. The URL is left in
      // place, which shows the owner exactly which piece went missing.
    }
    onProgress?.(index + 1, urls.length);
  }

  return { ...row, payload: substituteStrings(row.payload, mapping) };
}

/**
 * Record what the owner decided.
 *
 * Only the owner may write these values — `contributions_resolve` pins the
 * statuses its `with check` will allow, and the column grant keeps `payload`
 * and `set_id` out of reach — so this is a record of a decision rather than the
 * decision's mechanism. Applying the entries happens locally, in the owner's
 * own document, and is not what this call does.
 */
export async function resolveContribution(
  id: string,
  decision: 'accepted' | 'declined',
  appliedKeys: readonly string[] = [],
  note = ''
): Promise<void> {
  await auth.ensureFresh();
  await request(`/rest/v1/set_contributions?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: {
      status: decision,
      applied_keys: [...appliedKeys],
      resolution_note: note.trim().slice(0, 500)
    },
    headers: { Prefer: 'return=minimal' }
  });
}

/** Take back an offer that has not been decided yet. */
export async function withdrawContribution(id: string): Promise<void> {
  await auth.ensureFresh();
  await request(`/rest/v1/set_contributions?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { status: 'withdrawn' },
    headers: { Prefer: 'return=minimal' }
  });
}

/** One person's public credit — nothing about what they contributed. */
export interface Contributor {
  display_name: string;
  avatar_url: string;
}

/**
 * Everyone whose offer took, for a set anyone can already see.
 *
 * Deliberately anonymous, like every other public read — see the note on
 * `listPublicSets`. The database function this calls is the actual boundary:
 * it answers only for a set that is unlisted or public, and only names
 * `accepted` contributions with at least one entry actually taken. What was
 * offered, declined, or left open stays as private as it always was; this is
 * a credit for what is already sitting in the published document, not a
 * window into the negotiation that produced it.
 */
export async function listContributors(setId: string): Promise<Contributor[]> {
  try {
    return await request<Contributor[]>('/rest/v1/rpc/set_contributors', {
      method: 'POST',
      body: { target: setId },
      anonymous: true
    });
  } catch {
    // A credit line is never worth failing a page over.
    return [];
  }
}

/** One contributor's name and how many changes of theirs actually landed. */
export interface ContributorTally {
  name: string;
  avatarUrl: string;
  changes: number;
}

/**
 * The owner's own view of who has helped, with counts.
 *
 * Built from `listContributions` rather than the public credit function —
 * the owner already has full read access to their own set's contributions
 * through RLS, so this needs no new grant, and it can afford to show more:
 * how many of each person's changes were actually taken, which the public
 * credit deliberately does not.
 */
export function tallyContributors(accepted: readonly ContributionSummary[]): ContributorTally[] {
  const byPerson = new Map<string, ContributorTally>();

  for (const offer of accepted) {
    const taken = offer.applied_keys.length;
    if (taken === 0) continue;

    const existing = byPerson.get(offer.contributor_id);
    if (existing) {
      existing.changes += taken;
      continue;
    }
    byPerson.set(offer.contributor_id, {
      name: offer.contributor?.display_name || 'Someone',
      avatarUrl: offer.contributor?.avatar_url ?? '',
      changes: taken
    });
  }

  return [...byPerson.values()].sort((a, b) => b.changes - a.changes);
}

/**
 * How many offers are waiting, per set the caller owns.
 *
 * One call for the whole library rather than one per set: Set Home shows a
 * badge, and a badge is not worth a request each time a set is opened.
 */
export async function openContributionCounts(): Promise<Map<string, number>> {
  if (!auth.signedIn) return new Map();
  await auth.ensureFresh();
  try {
    const rows = await request<{ set_id: string; open_count: number }[]>(
      '/rest/v1/rpc/open_contribution_counts',
      { method: 'POST', body: {} }
    );
    return new Map(rows.map((row) => [row.set_id, Number(row.open_count)]));
  } catch {
    // A badge is never worth an error message.
    return new Map();
  }
}
