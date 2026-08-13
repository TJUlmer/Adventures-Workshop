/**
 * The signed-in author's own row in `profiles` — the one thing OAuth decides
 * for them by default and the one thing this file lets them take back.
 *
 * `handle_new_user` (see `supabase/migrations/0002_gallery.sql`) seeds
 * `display_name` from whatever the provider hands back at first sign-in —
 * Google's `full_name`, which is a real name, not a handle. That is a sensible
 * default and a bad permanent state: it means a real name goes out under every
 * set someone publishes and every contribution they offer, without them
 * having chosen that. The trigger only ever runs once, at signup, so nothing
 * here is fighting it — an author who changes their display name keeps
 * whatever they set from then on.
 *
 * `profiles` is readable by anyone (`profiles_public_read using (true)`), so
 * fetching a row is never the security boundary here — the *default value* is
 * the thing worth fixing, and this file is what lets an author fix it.
 */
import { auth } from './auth.svelte';
import { request } from './http';

export interface OwnProfile {
  displayName: string;
  avatarUrl: string;
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
  const rows = await request<{ display_name: string; avatar_url: string }[]>(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=display_name,avatar_url&limit=1`
  );
  const row = rows[0];
  return row ? { displayName: row.display_name, avatarUrl: row.avatar_url } : null;
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
