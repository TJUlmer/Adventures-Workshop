/** A presentation container for a set's Tabletop Simulator export. */
export interface PresentationBox {
  enabled: boolean;
  /** Flattened PNG/JPEG exported from the six-face PSD guide. */
  skin: { source: string; label: string } | null;
}

export function createPresentationBox(): PresentationBox {
  return { enabled: false, skin: null };
}
