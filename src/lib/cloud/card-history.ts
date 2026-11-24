import type { CardId } from '$lib/cards/types';
import type { SetId } from '$lib/sets/types';
import { auth } from './auth.svelte';
import { request } from './http';

export interface PublishedCardRevisionRange {
  first_revision: number;
  last_revision: number;
  front_path: string;
  back_path: string | null;
}

export interface PublishedCardHistory {
  publication_id: string;
  publication_name: string;
  scope: 'full' | 'hero' | 'villain';
  latest_revision: number;
  ranges: PublishedCardRevisionRange[];
}

export async function fetchPublishedCardHistory(
  setId: SetId,
  cardId: CardId,
  copy: number,
  signal: AbortSignal
): Promise<PublishedCardHistory[]> {
  await auth.ensureFresh();
  if (signal.aborted || !auth.user) return [];
  return request('/rest/v1/rpc/own_published_card_revisions', {
    method: 'POST',
    body: { requested_set: setId, requested_card: cardId, requested_copy: copy },
    signal
  });
}
