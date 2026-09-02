# Private cloud drafts rollout and recovery

This runbook covers the private `set_drafts`/`draft-assets` system. Publishing remains a
separate explicit snapshot workflow. The private-draft client is still pre-rollout: keep it
on `codex/cloud-drafts`, do not merge it to `main`, and do not build a public deployment with
the rollout mode set to `on` until every launch gate below has evidence.

## Rollout controls

Private drafts have a separate build-time gate from Supabase sharing:

| Variable | Meaning |
|---|---|
| `VITE_CLOUD_DRAFTS_ROLLOUT=off` | Default. No private-draft reads or writes; IndexedDB remains authoritative. Publishing still works. |
| `VITE_CLOUD_DRAFTS_ROLLOUT=opt-in` | A permanent account may explicitly enable the preview in Account on this browser. |
| `VITE_CLOUD_DRAFTS_ROLLOUT=cohort` | Allowlisted permanent accounts plus a stable percentage receive cloud-authoritative drafts. |
| `VITE_CLOUD_DRAFTS_ROLLOUT=on` | Every permanent account receives cloud-authoritative drafts. This is a launch action, not a development default. |
| `VITE_CLOUD_DRAFTS_INTERNAL_USER_IDS` | Comma-separated permanent Supabase user ids admitted in `cohort` mode. It grants no database permission. |
| `VITE_CLOUD_DRAFTS_COHORT_PERCENT` | Integer `0..100`; stable hashing assigns non-internal permanent accounts in `cohort` mode. |

The gate never admits an anonymous Auth user. Database and Storage policies independently
enforce the same rule. A browser opt-in is stored in IndexedDB under that permanent account,
not in `localStorage`, and is ignored when the build flag is `off`.

Recommended progression:

1. Keep production at `off` while deterministic and isolated-project checks run.
2. Use `opt-in` only on an internal preview deployment. This is an honest
   cloud-authoritative preview, not an invisible shadow upload; local copies are retained.
3. On a shared deployment, use `cohort` with internal ids and `0` percent, then increase the
   percentage only after the previous cohort meets the gates below.
4. Set `on` only after the user explicitly approves public rollout and every launch
   acceptance item in `CLOUD_STORAGE_PLAN.md` is evidenced.

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

## Verification still required before public rollout

- the complete two-browser core, offline/failure, concurrency, and existing-feature matrix in
  `CLOUD_STORAGE_PLAN.md` against an isolated project or explicitly authorised synthetic rows;
- two-owner and public-anon policy checks after the final deployed migration fingerprint;
- interrupted asset upload, interrupted document RPC, expired-token, IndexedDB failure, and
  future-schema refusal with network evidence;
- successful Google linking and the identity-already-linked recovery case;
- the pilot gates above, followed by explicit approval to merge and enable the feature.
