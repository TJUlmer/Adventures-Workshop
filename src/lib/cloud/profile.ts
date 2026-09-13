/**
 * The signed-in author's own row in `profiles` — the one thing OAuth decides
 * for them by default and the one thing this file lets them take back.
 *
 * `handle_new_user` seeds `display_name` from the part of the account email
 * before `@`, rather than accepting an OAuth provider's real name as public by
 * default. The trigger only ever runs once, at signup, so an author who changes
 * their display name keeps whatever they set from then on.
 *
 * `profiles` is readable by anyone (`profiles_public_read using (true)`), so
 * fetching a row is never the security boundary here. This file lets an
 * author replace or clear that public default at any time.
 */
import { auth } from './auth.svelte';
import { request } from './http';

export interface OwnProfile {
  displayName: string;
  avatarUrl: string;
  /** Server-owned; selected only to decide whether admin tools are shown. */
  isAdmin: boolean;
}

/**
 * The signed-in author's own display name and avatar.
 *
 * Authenticated rather than anonymous, on purpose: this is "my own row," the
 * same footing `setVisibility`/`unpublishSet` already stand on, not the
 * public-listing case `fetchAuthorName` is — where the reader might have no
 * session at all and a stale token must not be allowed to break the read.
 * Here a stale token is exactly what `ensureFresh` is for.
 */
export async function fetchOwnProfile(): Promise<OwnProfile | null> {
  const id = auth.user?.id;
  if (!id) return null;

  await auth.ensureFresh();
  const rows = await request<{ display_name: string; avatar_url: string; is_admin: boolean }[]>(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=display_name,avatar_url,is_admin&limit=1`
  );
  const row = rows[0];
  return row
    ? { displayName: row.display_name, avatarUrl: row.avatar_url, isAdmin: row.is_admin }
    : null;
}

/**
 * Replace the name shown under anything this account publishes.
 *
 * Blank is a legitimate choice, not an error — it is the more private of the
 * two options, and `GalleryScreen`/`ContributionsScreen` already read a blank
 * `display_name` as "Anonymous" rather than as broken data. `avatar_url` is
 * left alone: only the name is what a Google account fills in without asking.
 */
export async function updateOwnDisplayName(name: string): Promise<void> {
  const id = auth.user?.id;
  if (!id) return;

  await auth.ensureFresh();
  await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { display_name: name.trim() },
    headers: { Prefer: 'return=minimal' }
  });
}
