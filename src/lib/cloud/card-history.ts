import type { CardId } from '$lib/cards/types';
import { request } from './http';

export interface PublishedCardHistorySource {
  slug: string;
  revision: number;
}

export interface PublishedCardRevisionRange {
  first_revision: number;
  last_revision: number;
  front_path: string;
  back_path: string | null;
}

export interface PublishedCardHistory {
  latest_revision: number;
  ranges: PublishedCardRevisionRange[];
}

export function fetchPublishedCardHistory(
  slug: string,
  cardId: CardId,
  copy: number,
  signal: AbortSignal
): Promise<PublishedCardHistory | null> {
  return request('/rest/v1/rpc/published_card_revisions', {
    method: 'POST',
    body: { share_slug: slug, requested_card: cardId, requested_copy: copy },
    anonymous: true,
    signal
  });
}
