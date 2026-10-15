const DAY_MS = 24 * 60 * 60 * 1000;

export const RECENTLY_DELETED_RETENTION_DAYS = 30;
export const RECENTLY_DELETED_RETENTION_MS = RECENTLY_DELETED_RETENTION_DAYS * DAY_MS;

function deletedTime(deletedAt: string | null | undefined): number | null {
  if (!deletedAt) return null;
  const parsed = Date.parse(deletedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Invalid legacy timestamps are retained rather than becoming accidental permanent deletion. */
export function recentlyDeletedExpired(
  deletedAt: string | null | undefined,
  referenceTime = Date.now()
): boolean {
  const deleted = deletedTime(deletedAt);
  return deleted !== null && deleted <= referenceTime - RECENTLY_DELETED_RETENTION_MS;
}

export function recentlyDeletedDaysRemaining(
  deletedAt: string | null | undefined,
  referenceTime = Date.now()
): number | null {
  const deleted = deletedTime(deletedAt);
  if (deleted === null) return null;
  const remaining = Math.ceil(
    (deleted + RECENTLY_DELETED_RETENTION_MS - referenceTime) / DAY_MS
  );
  return Math.max(0, Math.min(RECENTLY_DELETED_RETENTION_DAYS, remaining));
}
