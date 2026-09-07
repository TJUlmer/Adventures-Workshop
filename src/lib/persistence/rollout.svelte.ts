/** Default-off, account-stable rollout gate for private cloud drafts. */
import { auth } from '$lib/cloud/auth.svelte';
import {
  cloudDraftRolloutConfig,
  cloudEnabled,
  type CloudDraftRolloutMode
} from '$lib/cloud/config';
import { readCloudDraftPreference, writeCloudDraftOptIn } from '$lib/storage/settings';

export interface DraftRolloutDecision {
  configured: boolean;
  mode: CloudDraftRolloutMode;
  userId: string | null;
  anonymous: boolean;
  /** `null` means no explicit choice has been made on this browser. */
  preference: boolean | null;
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

  /*
   * A person's explicit choice wins in every active rollout mode. Without
   * this, moving from opt-in to a 5% cohort would switch most early adopters
   * off, while default-on would silently undo a deliberate opt-out.
   */
  if (decision.preference !== null) return decision.preference;
  if (decision.mode === 'on') return true;
  if (decision.mode === 'opt-in') return false;
  return (
    decision.internalUserIds.includes(decision.userId) ||
    draftCohortBucket(decision.userId) < decision.cohortPercent
  );
}

class DraftRollout {
  readonly mode = cloudDraftRolloutConfig().mode;
  readonly cohortPercent = cloudDraftRolloutConfig().cohortPercent;
  preference = $state<boolean | null>(null);
  loadedForUserId = $state<string | null>(null);
  saving = $state(false);
  error = $state<string | null>(null);

  #request = 0;

  readonly preferenceLoaded = $derived.by(
    () =>
      auth.signedIn &&
      !auth.isAnonymous &&
      this.loadedForUserId === auth.user?.id
  );

  /** Every active mode retains a browser-level escape hatch. */
  readonly canChoose = $derived.by(
    () =>
      cloudEnabled() &&
      this.mode !== 'off' &&
      auth.signedIn &&
      !auth.isAnonymous &&
      this.preferenceLoaded
  );

  /** Compatibility for preview tools that only need to turn an opt-in build on. */
  readonly canOptIn = $derived(this.canChoose && this.mode === 'opt-in');

  readonly enabled = $derived.by(() => {
    const userId = auth.user?.id ?? null;
    /* Do not make a cloud request during sign-in before a saved opt-out has
       been read. Session restore already awaits `refresh`; this also closes
       the smaller live account-switch window. */
    if (userId && this.mode !== 'off' && this.loadedForUserId !== userId) return false;
    return evaluateDraftRollout({
      configured: cloudEnabled(),
      mode: this.mode,
      userId,
      anonymous: auth.isAnonymous,
      preference: this.preference,
      internalUserIds: cloudDraftRolloutConfig().internalUserIds,
      cohortPercent: this.cohortPercent
    });
  });

  async refresh(): Promise<void> {
    const request = ++this.#request;
    const userId = auth.signedIn && !auth.isAnonymous ? (auth.user?.id ?? null) : null;
    if (!userId) {
      this.loadedForUserId = null;
      this.preference = null;
      this.error = null;
      return;
    }

    const preference = await readCloudDraftPreference(userId);
    if (request !== this.#request || auth.user?.id !== userId) return;
    this.loadedForUserId = userId;
    this.preference = preference;
    this.error = null;
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    const userId = auth.user?.id ?? null;
    if (!userId || auth.isAnonymous || this.mode === 'off') return false;
    this.saving = true;
    this.error = null;
    try {
      if (!(await writeCloudDraftOptIn(userId, enabled))) {
        throw new Error('This browser could not remember the cloud-draft choice.');
      }
      this.loadedForUserId = userId;
      this.preference = enabled;
      return true;
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : 'Could not update cloud-draft access.';
      return false;
    } finally {
      this.saving = false;
    }
  }

  /** Older verifier entry points use the launch-era name. */
  setOptedIn(enabled: boolean): Promise<boolean> {
    return this.setEnabled(enabled);
  }
}

export const draftRollout = new DraftRollout();
