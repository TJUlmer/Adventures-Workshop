/** Default-off, account-stable rollout gate for private cloud drafts. */
import { auth } from '$lib/cloud/auth.svelte';
import {
  cloudDraftRolloutConfig,
  cloudEnabled,
  type CloudDraftRolloutMode
} from '$lib/cloud/config';
import { readCloudDraftOptIn, writeCloudDraftOptIn } from '$lib/storage/settings';

export interface DraftRolloutDecision {
  configured: boolean;
  mode: CloudDraftRolloutMode;
  userId: string | null;
  anonymous: boolean;
  optedIn: boolean;
  internalUserIds: readonly string[];
  cohortPercent: number;
}

/** Stable across browsers without storing another server-side assignment. */
export function draftCohortBucket(userId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

/** Pure policy boundary, exported for the browser verification harness. */
export function evaluateDraftRollout(decision: DraftRolloutDecision): boolean {
  if (!decision.configured || !decision.userId || decision.anonymous || decision.mode === 'off') {
    return false;
  }
  if (decision.mode === 'on') return true;
  if (decision.mode === 'opt-in') return decision.optedIn;
  return (
    decision.internalUserIds.includes(decision.userId) ||
    draftCohortBucket(decision.userId) < decision.cohortPercent
  );
}

class DraftRollout {
  readonly mode = cloudDraftRolloutConfig().mode;
  readonly cohortPercent = cloudDraftRolloutConfig().cohortPercent;
  optedIn = $state(false);
  loadedForUserId = $state<string | null>(null);
  saving = $state(false);
  error = $state<string | null>(null);

  #request = 0;

  readonly canOptIn = $derived.by(
    () =>
      cloudEnabled() &&
      this.mode === 'opt-in' &&
      auth.signedIn &&
      !auth.isAnonymous &&
      this.loadedForUserId === auth.user?.id
  );

  readonly enabled = $derived.by(() => {
    const userId = auth.user?.id ?? null;
    const optedIn = this.loadedForUserId === userId && this.optedIn;
    return evaluateDraftRollout({
      configured: cloudEnabled(),
      mode: this.mode,
      userId,
      anonymous: auth.isAnonymous,
      optedIn,
      internalUserIds: cloudDraftRolloutConfig().internalUserIds,
      cohortPercent: this.cohortPercent
    });
  });

  async refresh(): Promise<void> {
    const request = ++this.#request;
    const userId = auth.signedIn && !auth.isAnonymous ? (auth.user?.id ?? null) : null;
    if (!userId) {
      this.loadedForUserId = null;
      this.optedIn = false;
      this.error = null;
      return;
    }

    const optedIn = await readCloudDraftOptIn(userId);
    if (request !== this.#request || auth.user?.id !== userId) return;
    this.loadedForUserId = userId;
    this.optedIn = optedIn;
    this.error = null;
  }

  async setOptedIn(enabled: boolean): Promise<boolean> {
    const userId = auth.user?.id ?? null;
    if (!userId || auth.isAnonymous || this.mode !== 'opt-in') return false;
    this.saving = true;
    this.error = null;
    try {
      if (!(await writeCloudDraftOptIn(userId, enabled))) {
        throw new Error('This browser could not remember the cloud-draft choice.');
      }
      this.loadedForUserId = userId;
      this.optedIn = enabled;
      return true;
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : 'Could not update cloud-draft access.';
      return false;
    } finally {
      this.saving = false;
    }
  }
}

export const draftRollout = new DraftRollout();
