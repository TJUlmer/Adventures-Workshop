# Direct preview editing Phase 4 evidence

Phase 4 hardens the completed action-card interaction for keyboard,
coarse-pointer, narrow-layout, state-change and export use. It also adds an
accessible `1–20` **Copies in deck** stepper beside the quantity beneath the
authoring preview. The controls are outside `.plate` and therefore cannot be
captured by card exports.

`interaction-evidence.json` records the exercised accessibility, responsive,
lifecycle, quantity, renderer-isolation and persistence checks. The Phase 0
fixture was regenerated against Phase 4 and all seven geometry checks passed.
Strict decoded-pixel comparison retained the documented cross-environment
browser/font-rendering variance. Phase 4 changes no renderer, print, Tabletop
Simulator or export module.

The preview branch remains the review surface. Promotion to `main` and the
post-promotion production checks deliberately remain pending until the user
accepts this hosted Phase 4 build.
