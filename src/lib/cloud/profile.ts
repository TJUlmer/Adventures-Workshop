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

/** Replace the public name and externally hosted avatar for this account. */
export async function updateOwnProfile(name: string, avatarUrl: string): Promise<void> {
  const avatar = avatarUrl.trim();
  const id = auth.user?.id;
  if (!id) return;

  if (avatar.length > 2048) throw new Error('That image URL is too long.');
  if (avatar) {
    let parsed: URL;
    try {
      parsed = new URL(avatar);
    } catch {
      throw new Error('Enter a complete image URL beginning with https://.');
    }
    if (parsed.protocol !== 'https:') {
      throw new Error('Profile images must use a secure https:// URL.');
    }
  }

  await auth.ensureFresh();
  await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    /* The image stays on its original host; only this small public URL is stored. */
    body: { display_name: name.trim(), avatar_url: avatar },
    headers: { Prefer: 'return=minimal' }
  });
}
