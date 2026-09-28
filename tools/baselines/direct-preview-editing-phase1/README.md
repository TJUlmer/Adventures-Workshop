# Direct preview editing Phase 1 evidence

Phase 1 maps every supported visible action-card field to the exact existing
Content control. The renderer carries inert source markers; the authoring
preview measures them and mounts accessible hotspot buttons in a sibling
overlay outside `.plate`.

`interaction-evidence.json` records the desktop, split-card, responsive,
identity, geometry, and export-safety checks exercised in the browser. The
Phase 0 exporter was regenerated against this code before the comparison.

The committed Phase 0 manifest remains the reference. Its dimensions all
matched. Seven decoded PNG entries varied across runs, consistent with the
cross-run renderer variance already recorded during Phase 0; no control or
overlay is mounted by the detached exporter.
