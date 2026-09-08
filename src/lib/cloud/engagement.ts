/**
 * Community activity around published sets.
 *
 * Public catalogue reads stay in `sets.ts` and deliberately remain anonymous.
 * Everything here that belongs to one person refreshes the account first, so a
 * stale sign-in can lose its decoration without ever taking the gallery away.
 */
import { auth } from './auth.svelte';
import { CloudError, request } from './http';

export type FavouriteTarget =
  | { kind: 'set'; set_id: string }
  | {
      kind: 'character';
      owner_id: string;
      local_id: string;
      character_id: string;
    };

export interface SetComment {
  id: string;
  set_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  author: { display_name: string; avatar_url: string } | null;
}

const PAGE = 1000;

/** Stable across the set and character galleries, without exposing user ids. */
export function favouriteKey(target: FavouriteTarget): string {
  return target.kind === 'set'
    ? `set:${target.set_id}`
    : `character:${target.owner_id}:${target.local_id}:${target.character_id}`;
}

function cleanComment(body: string): string {
  const value = body.trim();
  if (value.length === 0) throw new CloudError('Write something before posting.', 0);
  if (value.length > 2000) throw new CloudError('Comments can be up to 2,000 characters.', 0);
  return value;
}

async function requirePermanentAccount(): Promise<void> {
  await auth.ensureFresh();
  if (!auth.user || auth.isAnonymous) {
    throw new CloudError('Sign in with a permanent account to join the conversation.', 401);
  }
}

async function allRows<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const join = path.includes('?') ? '&' : '?';
    const page = await request<T[]>(`${path}${join}limit=${PAGE}&offset=${offset}`);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** The sets this account has liked. The identities are never publicly listed. */
export async function listMyLikes(): Promise<string[]> {
  await requirePermanentAccount();
  const rows = await allRows<{ set_id: string }>('/rest/v1/set_likes?select=set_id');
  return rows.map((row) => row.set_id);
}

/** Every exact gallery item this account has saved. */
export async function listMyFavourites(): Promise<FavouriteTarget[]> {
  await requirePermanentAccount();
  const [sets, characters] = await Promise.all([
    allRows<{ set_id: string }>(
      '/rest/v1/set_favourites?select=set_id&order=created_at.desc'
    ),
    allRows<{ owner_id: string; local_id: string; character_id: string }>(
      '/rest/v1/character_favourites?' +
        'select=owner_id,local_id,character_id&order=created_at.desc'
    )
  ]);
  return [
    ...sets.map((target) => ({ kind: 'set' as const, ...target })),
    ...characters.map((target) => ({ kind: 'character' as const, ...target }))
  ];
}

export async function setLiked(setId: string, liked: boolean): Promise<void> {
  await requirePermanentAccount();
  if (liked) {
    await request('/rest/v1/set_likes?on_conflict=set_id,user_id', {
      method: 'POST',
      body: { set_id: setId },
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }
    });
    return;
  }

  await request(`/rest/v1/set_likes?set_id=eq.${encodeURIComponent(setId)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });
}

export async function setFavourite(
  target: FavouriteTarget,
  favourite: boolean
): Promise<void> {
  await requirePermanentAccount();
  const table = target.kind === 'set' ? 'set_favourites' : 'character_favourites';
  const conflict =
    target.kind === 'set'
      ? 'set_id,user_id'
      : 'owner_id,local_id,character_id,user_id';
  if (favourite) {
    const body =
      target.kind === 'set'
        ? { set_id: target.set_id }
        : {
            owner_id: target.owner_id,
            local_id: target.local_id,
            character_id: target.character_id
          };
    await request(`/rest/v1/${table}?on_conflict=${conflict}`, {
      method: 'POST',
      body,
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }
    });
    return;
  }

  const filter =
    target.kind === 'set'
      ? `set_id=eq.${encodeURIComponent(target.set_id)}`
      : `owner_id=eq.${encodeURIComponent(target.owner_id)}` +
        `&local_id=eq.${encodeURIComponent(target.local_id)}` +
        `&character_id=eq.${encodeURIComponent(target.character_id)}`;
  await request(`/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });
}

/** Public comments, kept anonymous from the reader's own session. */
export async function listSetComments(setId: string): Promise<SetComment[]> {
  const columns =
    'id,set_id,author_id,body,created_at,updated_at,' +
    'author:profiles(display_name,avatar_url)';
  return request<SetComment[]>(
    `/rest/v1/set_comments?select=${columns}&set_id=eq.${encodeURIComponent(setId)}` +
      '&order=created_at.asc',
    { anonymous: true }
  );
}

export async function createSetComment(setId: string, body: string): Promise<void> {
  await requirePermanentAccount();
  await request('/rest/v1/set_comments', {
    method: 'POST',
    body: { set_id: setId, body: cleanComment(body) },
    headers: { Prefer: 'return=minimal' }
  });
}

export async function editSetComment(commentId: string, body: string): Promise<void> {
  await requirePermanentAccount();
  await request(`/rest/v1/set_comments?id=eq.${encodeURIComponent(commentId)}`, {
    method: 'PATCH',
    body: { body: cleanComment(body) },
    headers: { Prefer: 'return=minimal' }
  });
}

/** Soft deletion preserves moderation history while removing the public row. */
export async function deleteSetComment(commentId: string): Promise<void> {
  await requirePermanentAccount();
  const removed = await request<boolean>('/rest/v1/rpc/delete_own_set_comment', {
    method: 'POST',
    body: { target: commentId }
  });
  if (!removed) throw new CloudError('That comment is already gone or belongs to someone else.', 404);
}

export async function reportSetComment(commentId: string, reason: string): Promise<void> {
  await request('/rest/v1/set_comment_reports', {
    method: 'POST',
    body: { comment_id: commentId, reason: reason.trim().slice(0, 500) },
    headers: { Prefer: 'return=minimal' }
  });
}
