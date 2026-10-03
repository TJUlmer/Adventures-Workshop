/** Browser-level Bonus ability inks, shared by every open ability editor. */
import {
  readBonusAbilityInkPresets,
  writeBonusAbilityInkPresets,
  type BonusAbilityInkPresets
} from '$lib/storage/settings';

class BonusAbilityInkPresetStore {
  values = $state<BonusAbilityInkPresets>([null, null, null]);
  loaded = $state(false);

  #loading: Promise<void> | null = null;
  #revision = 0;

  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    const revision = this.#revision;
    this.#loading ??= readBonusAbilityInkPresets().then((values) => {
      if (revision !== this.#revision) return;
      this.values = values;
      this.loaded = true;
    });
    return this.#loading;
  }

  set(index: number, ink: string | null): void {
    if (index < 0 || index >= this.values.length) return;
    const next: BonusAbilityInkPresets = [this.values[0], this.values[1], this.values[2]];
    next[index] = ink;
    this.#revision += 1;
    this.values = next;
    this.loaded = true;
    /* The swatch remains useful for this session if browser storage is
       unavailable; persistence failure does not undo a choice already made. */
    void writeBonusAbilityInkPresets(next);
  }
}

export const bonusAbilityInkPresets = new BonusAbilityInkPresetStore();
