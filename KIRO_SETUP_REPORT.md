# Kiro Setup Report

Kiro configuration added alongside the existing Claude Code setup. **Nothing under
`.claude/` and nothing in `CLAUDE.md` was deleted, modified or renamed.** Both tools
remain fully usable on this codebase.

## Step 1 — Inventory of the Claude Code setup

The `.claude/` directory in this project is much smaller than a typical full Claude
Code setup. Everything actually present:

| File | Purpose |
| --- | --- |
| `CLAUDE.md` | The whole of the project's AI guidance: commands, the zero-dependency / local-first / runes-only constraints, renderer-is-export architecture, measured geometry, schema repair rules, the verification loop, known traps, and code-style conventions. |
| `.claude/launch.json` | Registers the Vite dev server as a named launch config (`adventures-workshop`, port 5173, `autoPort`) so Claude Code's preview tooling can start it. |
| `.claude/settings.local.json` | Per-machine command permission allowlist (PowerShell and Bash invocations Claude Code may run without prompting). Git-ignored via the `*.local` rule in `.gitignore`. |

**Not present** — confirmed by a recursive, force-included listing of `.claude/`:

- `CLAUDE.local.md`
- `.claude/rules/`
- `.claude/skills/`
- `.claude/agents/`
- `.claude/commands/`
- `.claude/settings.json` (only the git-ignored `settings.local.json` exists)

So Steps 4, 5, 6 and 7 of the setup brief had no source material to convert. The
directories were still created so the structure is ready when those features get used.

Two other root docs were read for context because `CLAUDE.md` defers to them:
`README.md` (document model, style cascade, shell, project structure) and
`SET-HEALTH.md` (referenced only; set-health grading).

## Step 2 — Directories created

```
.kiro/steering/
.kiro/agents/     (.gitkeep — empty)
.kiro/hooks/      (.gitkeep — empty)
.kiro/settings/   (.gitkeep — empty)
.kiro/skills/     (.gitkeep — empty)
```

`.gitkeep` files follow the convention already used in `assets/fonts/` and
`assets/patterns/`, so the empty directories survive a commit.

## Steps 3–8 — What was created

### Always-loaded steering (the foundation three)

| File | Contents pulled from `CLAUDE.md` / `README.md` |
| --- | --- |
| `.kiro/steering/product.md` | Product purpose, target users, the local-first / one-portable-file / print-fidelity goals, three-pane shell, card-editor decisions, and the deliberately-unbuilt seams. |
| `.kiro/steering/tech.md` | Svelte 5 + TS + Vite, the four npm scripts, the `svelte-check`-is-the-only-gate rule, strict `tsconfig` flags, the TypeScript `~6` pin, no-test-suite fact, the three hard constraints (zero runtime deps, local-first, runes only), and the models/threat/rich-text subsystems. |
| `.kiro/steering/structure.md` | Directory tree, four-flat-arrays data model, branded IDs, style cascade including the two ways `README.md` has drifted, state/store conventions, design-token rule, and the code-style conventions (comments explain *why*; British spelling). |

### Conditional steering (`inclusion: auto`)

Content from `CLAUDE.md` that did not belong in the foundation three, split by concern
so it loads when relevant rather than on every turn:

| File | When it applies |
| --- | --- |
| `.kiro/steering/renderer-and-export.md` | Touching `src/lib/renderer/`, `src/lib/export/`, card faces, `ThreatBoard`, or anything rasterised. Holds the render-is-export invariant, the six-step rasterisation pipeline and its three failure modes, the masking technique, and the derived-asset regeneration rule. |
| `.kiro/steering/geometry.md` | Adding or correcting numbers in `renderer/geometry.ts`, positioning chrome or text, or working with `public/assets/templates/`. Holds bleed-pixel measurement, the Python/PIL snippet, cap-height placement, and the nothing-measures-text-at-runtime rule. |
| `.kiro/steering/schema-and-persistence.md` | Adding or changing any persisted field, or touching `sets/normalize.ts`, `src/lib/storage/`, serialisation, or `SET_SCHEMA_VERSION`. Holds the repair-not-migrate rule and absent-vs-empty distinction. |
| `.kiro/steering/verifying-changes.md` | Before claiming a change works, and when debugging rendering, fonts, canvas, layout or store state. Holds the three-step verification loop and the six known traps. |

### Shared bridge file

`AGENTS.md` at the project root — 88 lines. A condensed, always-relevant summary
(product, stack and commands, hard constraints, key conventions, known traps) that
both tools can read as the fastest-loading shared source of truth. It points at
`CLAUDE.md`, `README.md` and `.kiro/steering/` rather than duplicating them in full.

## Source → destination map

| Source | Destination | Conversion |
| --- | --- | --- |
| `CLAUDE.md` § Constraints, § Commands, TS pin, no-test-suite, § Other subsystems | `.kiro/steering/tech.md` | Split, `inclusion: always` |
| `CLAUDE.md` § Architecture (style cascade, schema pointer), § Writing code here + `README.md` § Project structure, § Data model, § State, § Design system | `.kiro/steering/structure.md` | Split + merged, `inclusion: always` |
| `README.md` intro, § The shell, § The card editor, § Not built yet | `.kiro/steering/product.md` | Split, `inclusion: always` |
| `CLAUDE.md` § The renderer is the export, § Derived assets | `.kiro/steering/renderer-and-export.md` | Split, `inclusion: auto` |
| `CLAUDE.md` § Geometry is measured, not estimated | `.kiro/steering/geometry.md` | Split, `inclusion: auto` |
| `CLAUDE.md` § Schema | `.kiro/steering/schema-and-persistence.md` | Split, `inclusion: auto` |
| `CLAUDE.md` § Verifying changes, § Traps | `.kiro/steering/verifying-changes.md` | Split, `inclusion: auto` |
| `CLAUDE.md` + `README.md` (condensed) | `AGENTS.md` | Summarised bridge file |
| `.claude/launch.json` | — | Noted only; see manual review |
| `.claude/settings.local.json` | — | Not converted; see skipped |
| `.claude/rules/`, `.claude/skills/`, `.claude/agents/`, `.claude/commands/` | — | Do not exist |
| `.claude/settings.json` `mcpServers` | — | No such file, no such block |

## Step 5 reasoning — skills

No `.claude/skills/` directory exists, so there was nothing to triage. For reference,
the decision rule I would apply when skills are added:

- **Self-contained reference with a clear trigger** → `.kiro/skills/{name}/SKILL.md`
  with `name` and `description` frontmatter. Preferred, because it loads on demand.
- **Contextual guidance with no crisp trigger** → steering file with `inclusion: auto`.
- **Reacts to file save / create / delete** → `.kiro/hooks/{name}.json`.

Worth noting: the `CLAUDE.md` content I split into `geometry.md` and
`verifying-changes.md` is close to skill-shaped (a reference procedure with a clear
trigger). I kept both as `inclusion: auto` steering because they originated as inline
`CLAUDE.md` guidance, not as discrete skills, and because steering keeps them in one
place that mirrors `CLAUDE.md` section-for-section — which makes the sync job below
much easier. If either grows into a longer standalone procedure, promoting it to
`.kiro/skills/` is the natural next move.

## Step 6 reasoning — agents

No `.claude/agents/` directory exists, so no `.kiro/agents/*.json` files were created.
I did not invent agents that had no Claude Code counterpart. The directory is in place
with the intended shape for when one is added:

```json
{
  "name": "example",
  "description": "…",
  "prompt": "…persona and instructions…",
  "tools": ["read", "glob", "grep", "shell"],
  "allowedTools": ["read", "glob", "grep"],
  "resources": ["file://.kiro/steering/**/*.md"],
  "includeMcpJson": true
}
```

Add `"write"` to `tools` only when the agent's purpose genuinely requires modifying
code.

## Step 7 reasoning — MCP

`.claude/settings.json` does not exist, and `.claude/settings.local.json` contains only
a `permissions.allow` array — no `mcpServers` block. Nothing was recreated, and
`.kiro/settings/mcp.json` was **not** created; an empty or invented MCP config would be
misleading. The tool-name mapping to apply if servers are added later:
`fs_read` → `read`, `fs_write` → `write`, `execute_bash` → `shell`, `use_aws` → `aws`.

## Items needing manual review

1. **Dev server launch.** `.claude/launch.json` gives Claude Code a named launch
   config; Kiro has no equivalent file. `npm run dev` must be run as a background
   process or started by you — never as a blocking foreground command. This caveat is
   recorded in `verifying-changes.md`. If you want it automated in Kiro, a hook or a
   Kiro-side run configuration would need to be added deliberately.
2. **Command permissions.** The allowlist in `.claude/settings.local.json` is
   Claude-Code-shaped and machine-specific (it embeds absolute paths and one-off
   `sed`/`Set-Content` invocations). Kiro's equivalent lives in agent configs and
   trusted-command settings, so a mechanical translation would be noise. Review it
   yourself if you want the same friction-free commands under Kiro. It is git-ignored
   by the `*.local` rule, so it is local to this machine anyway.
3. **Typecheck not run.** This change set is documentation and config only — no source
   file was touched — but I was unable to run `npm run check` to confirm a clean
   baseline: `npm.ps1` is blocked by this machine's PowerShell execution policy
   (`running scripts is disabled on this system`), and the `npm.cmd` / `npx` fallbacks
   did not return usable output in this shell. Please run `npm run check` yourself if
   you want the baseline confirmed. Nothing I added can affect it.
4. **`SET-HEALTH.md` was not split into steering.** It is referenced from
   `product.md` rather than copied. If set-health tuning becomes frequent, it is a good
   candidate for its own `inclusion: auto` steering file.
5. **Steering `inclusion: auto`.** All four conditional files use `inclusion: auto`
   with a `description` as specified. If your Kiro build expects `fileMatch` plus
   `fileMatchPattern` instead, the descriptions already state the triggering paths, so
   converting is a small edit per file.

## Items intentionally skipped, and why

| Skipped | Why |
| --- | --- |
| Converting `.claude/rules/`, `.claude/skills/`, `.claude/agents/`, `.claude/commands/` | None of these directories exist in this project. |
| Creating `.kiro/settings/mcp.json` | No `mcpServers` block anywhere in the Claude Code config. An empty file would imply MCP is configured when it is not. |
| Creating any `.kiro/hooks/*.json` | No Claude Code skill or rule reacts to file save / create / delete events. The obvious candidate — running `npm run check` on save — was not invented, because `CLAUDE.md` deliberately frames `npm run check` as a manual inner-loop step, and a save hook on a project this size would fire constantly. Easy to add later with `createHook` if you want it. |
| Adding a test framework or test files | `CLAUDE.md` states plainly that there is no test suite and correctness is verified by driving the app. Recorded as a constraint in `tech.md`, not overridden. |
| Touching anything under `.claude/` or `CLAUDE.md` | Explicitly out of scope. Both tools stay usable. |
| Adding `.kiro/` to `.gitignore` | The Kiro config is shared project context and should be committed, same as `CLAUDE.md`. |

## Keeping in sync

**Kiro does not read `.claude/` and Claude Code does not read `.kiro/`.** Neither tool
will notice the other's config drifting. When you change one side, update the other:

| When this changes | Also update |
| --- | --- |
| `CLAUDE.md` | The matching `.kiro/steering/` file, and `AGENTS.md` if the change is always-relevant. The steering split mirrors `CLAUDE.md` section-for-section, so the target is usually obvious — see the source → destination map above. |
| `.claude/rules/*` (once any exist) | The matching `.kiro/steering/{name}.md` |
| `.claude/agents/*` (once any exist) | The matching `.kiro/agents/{name}.json` |
| `.claude/skills/*` (once any exist) | `.kiro/skills/{name}/SKILL.md`, or a steering file / hook per the Step 5 rule above |
| `.claude/settings.json` `mcpServers` (once it exists) | `.kiro/settings/mcp.json`, applying the tool-name mapping |
| A constraint, command, convention or trap — in either tool's config | `AGENTS.md`, which both tools read and which should stay the shortest true summary |

Practical habit: treat `AGENTS.md` as the canonical short version. When a project
convention changes, edit `AGENTS.md` first, then propagate to `CLAUDE.md` and
`.kiro/steering/`. That way the two toolchains can only drift in detail, never on the
essentials.

Keep `AGENTS.md` under 100 lines (currently 88). It is loaded on every turn, so length
there costs more than length in a conditional steering file.
