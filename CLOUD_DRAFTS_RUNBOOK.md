# Private cloud drafts rollout and recovery

This runbook covers the private `set_drafts`/`draft-assets` system. Publishing remains a
separate explicit snapshot workflow. The public opt-in beta was activated from `main` on
7 September 2026 with rollout mode `opt-in`. Do not change Production to `cohort` or `on`
until real-user, device, and connection diversity supplies the remaining automatic-enrolment
evidence and the user explicitly approves that broader rollout.

## Rollout controls

Private drafts have a separate build-time gate from Supabase sharing:

| Variable | Meaning |
|---|---|
| `VITE_CLOUD_DRAFTS_ROLLOUT=off` | Default. No private-draft reads or writes; IndexedDB remains authoritative. Publishing still works. |
| `VITE_CLOUD_DRAFTS_ROLLOUT=opt-in` | A permanent account may explicitly enable the beta in Account on this browser. |
| `VITE_CLOUD_DRAFTS_ROLLOUT=cohort` | Allowlisted permanent accounts plus a stable percentage receive cloud-authoritative drafts. |
| `VITE_CLOUD_DRAFTS_ROLLOUT=on` | Every permanent account receives cloud-authoritative drafts. This is a launch action, not a development default. |
| `VITE_CLOUD_DRAFTS_INTERNAL_USER_IDS` | Comma-separated permanent Supabase user ids admitted in `cohort` mode. It grants no database permission. |
| `VITE_CLOUD_DRAFTS_COHORT_PERCENT` | Integer `0..100`; stable hashing assigns non-internal permanent accounts in `cohort` mode. |

The gate never admits an anonymous Auth user. Database and Storage policies independently
enforce the same rule. A browser opt-in is stored in IndexedDB under that permanent account,
not in `localStorage`, and is ignored when the build flag is `off`.

Recommended progression:

1. Keep production at `off` while deterministic, recovery-project, and preview checks run.
2. Use `opt-in` on the internal preview. This is an honest cloud-authoritative preview, not
   an invisible shadow upload; local copies are retained.
3. After the owner-operated gates pass, use `opt-in` for the public beta. Every permanent
   account remains device-only until that person deliberately chooses **Try cloud drafts** in
   Account on that browser.
4. Observe real opt-in authors before testing automatic enrolment. If automatic enrolment is
   tested, use `cohort` with internal ids and a small stable percentage first.
5. Set `on` only after the user explicitly approves default-on rollout and the real-user,
   device, connection, error, conflict, and latency evidence remains within the gates below.

## Public opt-in beta activation checklist

Preparation does not itself activate the beta. Before merging or changing Production:

1. Bring the rollout branch up to date with `main`, review the complete branch diff, and run
   `npm run build`.
2. Run a Vercel-production-shaped build with `VERCEL_ENV=production` and confirm the synthetic
   policy, soak, and large-asset verifier pages are absent from `dist/tools`.
3. Confirm the latest native hourly backup and encrypted off-site backup completed, and retain
   the verified full-recovery evidence.
4. In Vercel, prepare `VITE_CLOUD_DRAFTS_ROLLOUT=opt-in` for **Production only**. Keep
   `VITE_CLOUD_DRAFTS_INTERNAL_USER_IDS` empty and `VITE_CLOUD_DRAFTS_COHORT_PERCENT=0`.
   Do not put a Supabase secret or service-role key in any `VITE_` variable.
5. Confirm Supabase's production Site URL and redirect allowlist cover the production hostname.
6. Obtain explicit approval, merge `codex/cloud-drafts` into `main`, and let Vercel deploy the
   production build. The merge/deployment is the activation point.

Immediately after deployment:

1. In a signed-out browser, confirm existing device sets open and the gallery still loads.
2. Sign in with a permanent account. Account must show **Cloud drafts beta**, initially off for
   that browser, and Home must remain device-authoritative until **Try cloud drafts** is chosen.
3. Opt in, upload one disposable set, confirm **Saved locally and to cloud**, then recover it in
   a clean second browser. Delete the disposable set permanently after verification.
4. Publish or update one disposable snapshot and confirm the public gallery path is unchanged.
5. Confirm the latest backup tasks still report success. If any cloud-authoritative safety check
   fails, set Production back to `off` and redeploy; do not delete cloud rows or private assets.

Launch record: the user explicitly approved the merge and Production deployment on 7 September
2026. Merge commit `e4c17c7` passed the exact `VERCEL_ENV=production` and
`VITE_CLOUD_DRAFTS_ROLLOUT=opt-in` build with zero diagnostics. The deployed bundle exposed the
beta choice while omitting every synthetic verifier entry; the three verifier URLs returned 404.
Signed-out device-only behaviour, the public gallery, and the Account sign-in surface loaded with
no browser errors. A permanent account then opted in independently in two browser contexts, the
clean context recovered an existing cloud draft, a new production revision propagated back to
the first context, and the harmless smoke-test change was removed and saved successfully. No
existing local-only set was uploaded automatically.

## What disabling the gate does

Disabling private drafts stops new private-draft reads and writes, pauses active delivery
queues, and returns Home to the self-contained IndexedDB library. It does not delete cloud
rows, private assets, cached documents, pending local generations, or exported files.

An in-flight request may already have reached the server when a running preview is disabled.
The stopped client deliberately does not acknowledge that response locally. If the preview is
later re-enabled, the revision check either reconciles the result or surfaces a conflict; it
never assumes that an interrupted request did not arrive.

Rollback therefore means deploying a build with `VITE_CLOUD_DRAFTS_ROLLOUT=off`. Never drop
`set_drafts`, delete `draft-assets`, clear browser storage, or rewrite cached revision metadata
as a rollback technique.

## Support report

Account offers **Download report** after a permanent session has recorded save activity. The
JSON contains at most the latest 100 events. Each event has:

- an opaque draft correlation key;
- save stage (`local-cache`, `assets`, `document`, or `acknowledgement`);
- outcome, HTTP status when a failure supplied one, duration, byte count, remote revision,
  and retry count.

The report contains no document or artwork data, set names, account details, real set ids,
private object paths, request bodies, URLs, access tokens, or refresh tokens. It remains on
the device until the author deliberately downloads and shares it.

Read a report from the bottom upwards. A successful `local-cache` event proves the current
generation reached IndexedDB. A failed `assets` event means no document RPC should have run.
A successful `document` followed by failed `acknowledgement` means the server may be ahead of
the local revision; reopen or retry so the revision check can reconcile it rather than forcing
an overwrite. Repeated retryable status `0`, `408`, `429`, or `5xx` events should leave the
document pending locally.

## Author recovery procedure

1. Do not clear site data, reinstall the browser, or delete either draft.
2. If the set opens, use the always-visible JSON export first. This is the portable safety copy.
3. Download the cloud save support report from Account.
4. If the rollout is disabled, continue from a cached device copy. An uncached cloud-only row
   being absent from Home while disabled is not evidence that it was deleted.
5. For offline or retrying status, keep the tab available and reconnect. The newest pending
   generation is the only generation delivered when the queue resumes.
6. For a conflict, choose the cloud version, this device's version, or **Save my changes as a
   separate copy**. Never bypass the choice by editing revision metadata.
7. If hydration fails, keep the cached document. A partial asset download is never installed or
   acknowledged as clean; re-enable connectivity and reopen.
8. Escalate with the exported set and support report before attempting database repair.

Database repair must preserve both the cloud row and the local/exported document until their
ids, revisions, hashes, and asset manifests have been compared. Recovery never republishes a
draft automatically; published snapshots change only through the existing Publish action.

## Pilot gates

These are minimum gates, not promises to users:

- zero silent overwrites, cross-account reads, missing-asset acknowledgements, or lost pending
  generations in every forced security/concurrency run;
- 100% of at least 20 deliberately stale saves surface a stopped conflict;
- at least 99% of 200 non-offline pilot saves succeed without support intervention;
- reference-only document saves have p95 stage duration at or below 2.5 seconds;
- documents with up to 10 MB of new assets have p95 end-to-end save time at or below 15 seconds
  on the pilot's ordinary broadband connection;
- opt-out and an `off` build both open cached documents and retain pending work;
- Google identity linking preserves the anonymous user id, and the already-linked failure path
  preserves both accounts, before anonymous authors can enter any cohort.

Local diagnostics are evidence for a pilot, not aggregate telemetry. Record sample size,
browser, connection conditions, and the anonymised reports outside the app. Do not add remote
diagnostic collection as a rollout shortcut without a separate privacy decision.

### Single-operator soak fallback

When a reliable multi-person pilot is unavailable, the deployed preview verifier at
`/tools/phase6-pilot-soak.html` provides a narrower service soak. It sends 200 distinct revisions
through the real IndexedDB-first persistence coordinator, requires a complete cloud
acknowledgement for every revision, and then submits 20 deliberately stale generations. Every
stale generation must leave the coordinator stopped in its conflict state and leave the accepted
server revision unchanged. The verifier reports p95 and maximum reference-save duration, verifies
the final row, and permanently removes only its uniquely prefixed synthetic cloud row and local
cache.

This is useful backend and client-path evidence, but it is not evidence from different devices,
connections, or authors. Passing it supports an owner-operated **opt-in beta**, not an immediate
default-on rollout. Keep the IndexedDB safety copy and backup regime in place, and assess the
first real opt-in users before changing the default.

On 6 September 2026, the deployed single-operator soak passed 200 of 200 ordinary saves and 20 of
20 stopped stale conflicts without intervention. The accepted row stayed at revision 200 through
all stale attempts. Reference-save p95 was 128 ms, the maximum was 290 ms, and the complete run
took 24,289 ms. The verifier confirmed that its synthetic cloud row and local cache were removed.
This satisfies the reference-only save-volume, success-rate, conflict, and timing gates.

The deployed large-asset verifier also passed on 6 September 2026. Five independent 9.5 MB
synthetic assets (47.5 MB uploaded in total) each completed the real IndexedDB, private Storage,
draft-save, authenticated-hydration, and exact-byte verification path. Save p95 and maximum were
2,907 ms against the 15,000 ms ceiling; hydration p95 and maximum were 2,331 ms. The complete run
took 28,943 ms and confirmed that every synthetic cloud row, Storage object, and local cache was
removed. This satisfies the separate near-10 MB new-asset performance gate.

## Acceptance evidence recorded

On 6 September 2026, the opt-in preview passed same-account clean-browser library and document
recovery, ordinary cross-browser revision propagation, all three stopped-conflict decisions,
private asset upload and hydration, offline edit delivery, interrupted document RPC recovery,
and interrupted required-asset upload recovery. The two interruption tests proved that pending
work remained locally durable and that the UI did not claim a cloud save before every required
stage succeeded. Soft delete, cross-browser restore, permanent purge of only the synthetic
conflict copy, self-contained JSON export/import, private publication denial to a signed-out
browser, explicit publication revision updates, and future-schema refusal also passed.

The downloaded support report contained the latest 100 events and no document content, account
identifiers, URLs, tokens, or asset paths. Its 18 deliberately failed network stages all had
status `0` and each was followed by a success for the same opaque draft and stage. Successful
local-cache, asset, and document stages had p95 durations of 3 ms, 535 ms, and 601 ms respectively.
An isolated unavailable-IndexedDB browser probe also passed: the failed local safety write was
reported, no cloud request was attempted, and the ordinary workshop database was untouched.
The real preview also renewed an expired access token with an HTTP 200 refresh while preserving
the signed-in session.
The deployed HTTP policy verifier then passed with an authenticated-anonymous session and two
different permanent OAuth accounts. The anonymous session could not use the draft backend;
Account B could not list or overwrite Account A's synthetic draft, or read or replace its private
asset. Account A verified that both remained unchanged before the verifier purged only its
synthetic data.
The single-operator soak results above then supplied the required 200 reference-only saves and 20
stopped conflicts at 100% success, with a 128 ms p95 and confirmed synthetic cleanup.
The large-asset verifier supplied five successful 9.5 MB new-asset saves and exact hydrations, with
a 2,907 ms save p95 and confirmed per-sample cleanup.
Details and the remaining gaps are recorded under Phase 6 in `CLOUD_STORAGE_PLAN.md`.

## Verification still required before automatic enrolment

- collect real-user connection, device, author, error, conflict, and latency evidence before
  changing Production from `opt-in` to `cohort` or `on`;
- explicitly approve each expansion and retain `off` as the no-deletion rollback.

Google identity linking and its identity-already-linked recovery case remain required before
anonymous accounts can enter cloud drafts. They do not block a permanent-account rollout while
anonymous authors remain clearly device-only.
