# Fast Feedback Loops

## Purpose

Overkill treats sub-second feedback as a first-class design constraint, not a future
optimization. A test runner that takes 5 seconds to compile, initialize and bootstrap
before running 500 tests in under a second is the wrong shape. The user will, in
practice, run the suite less often, lose trust in the inner loop, and stop relying on
tests as a thinking tool.

This document captures the concrete engineering knobs available in the pinned Node 26 runtime
that a test runner can pull _today_ to keep the cold path short and the hot path
sharable. Companion to [Platform-First Implementation Notes](./platform-first-implementation-notes.md) and
[Package Architecture § Standard Distribution](./package-architecture.md#standard-distribution).

One-package install must not mean one large startup graph. The standard
distribution can install benchmark, baseline, reporter, coverage, and resource
packages while keeping ordinary test-file imports and single-process
microtests narrow.

The investigation is structured around twelve technical areas; each section is
deliberately concrete so it can be turned into an issue or RFC without further
research.

## 1. Node native type stripping (Node 26-era baseline)

Use the pinned runtime's [TypeScript support](https://nodejs.org/api/typescript.html):

- `--experimental-strip-types` was unflagged by default in Node 22.18.0 / 23.6.0.
- Type stripping is stable in Node 25.2.0 / 24.12.0. Earlier releases removed
  the warning separately; lack of a warning did not establish stable support.
- Node 26 removed `--experimental-transform-types`. Non-erasable syntax needs
  an explicitly configured external transform or precompiled JavaScript.
- `.tsx` and JSX transformation are not supported by Node's type stripper.
  Browser harness transforms are a separate explicit integration.
- `--no-strip-types` disables the feature.
- Decorators are TC39 Stage 3, not yet implemented in V8, and currently a parser
  error in Node’s type stripper. Node will not transform them until the runtime
  natively supports decorators.
- Files inside `node_modules` are _not_ stripped by default. Only the top-level
  application graph is.
- Node intentionally ignores `tsconfig.json` at runtime. There is no path to
  configure TS semantics through Node.

Performance characteristics:

- The transformer is `amaro`, which wraps `@swc/wasm-typescript`. Whitespace-
  preserving stripping makes source maps unnecessary for line-accurate stack
  traces in the strip-only mode.
- Strip-only mode avoids JavaScript generation for erasable syntax. Measure
  its actual overhead on the pinned runtime rather than assuming a universal
  per-file cost or ranking against other tools.
- Node v24+ ships a **module compile cache** (`require(esm)` related work) that
  caches V8 bytecode. It does **not** cache the strip output.

Practical bottom line for Overkill:

- Strip-only mode is the default fast path. The `node test/foo.test.ts`
  invocation works directly; no loader required.
- For any code that uses enums, parameter properties, namespaces or JSX, Overkill
  reports a clear unsupported-syntax diagnostic unless the project explicitly
  configured a compatible transform. No automatic fallback changes the loader.
  Validate the native path with TypeScript's `erasableSyntaxOnly` setting.

## 2. Node Built-Ins First

The current concept should stay conservative here:

- prefer Node’s native type stripping
- prefer Node’s native watch mode
- avoid custom loader hooks in the default story
- avoid building a bespoke module graph or runner daemon as part of the
  core feedback-loop promise

External tools may still matter for edge cases, but the baseline concept
should not assume an Overkill-owned loader pipeline.

## 3. Execution-Path Comparisons

Native stripping is the default supported Node path. Explicit project transforms
and precompiled JavaScript are alternative inputs, not automatic fallbacks.
Browser harness delivery owns its separate transform requirements.

Startup guardrails measure the actual root import and CLI workloads on the
pinned runtime, recording platform, tool versions, loader, and cold/warm cache
state. Keep those measurements in benchmark artifacts and checked-in budgets.
Unsourced cross-tool timing estimates are not acceptance criteria or evidence
that a particular transform is too expensive.

## 4. Sharing parsed sources between tests in the same process

Inside a single Node process:

- Node’s ESM loader already caches modules by canonical URL. Once a `.ts` file
  is stripped and compiled, importing it again from another test module is
  free: same module record, same exports, no re-parse.
- Across workers / subprocesses, Node's module compile cache can handle
  bytecode reuse on the user's behalf for `require()` and `import`, but only
  if the runner enables it and shares the cache directory with child workers
  (`NODE_COMPILE_CACHE` or `module.enableCompileCache()`). If the parent wants
  workers created in the same run to benefit from modules it just compiled, it
  must flush the cache before spawning them. Lower-level
  `vm.Script#createCachedData()` and `vm.SourceTextModule#createCachedData()`
  exist for advanced cases but are not needed in the common path.
- The strip output itself is not cached across processes by Node. The
  compile cache and in-memory module cache should be measured before introducing
  another cache layer.
- If native type stripping fails, the runner should surface the module-load
  failure directly. Supporting non-erasable TypeScript syntax requires a
  deliberate Node or project-level transform outside Overkill's default path.

Recommendation: lean on Node's compile cache. Overkill should not ship its
own strip or bytecode cache by default; consider one only if measurement on a
real workload shows the strip cost actually dominates a run.

## 5. Loader Hooks

Overkill should not rely on loader hooks in the default concept.

They remain worth understanding for advanced integrations, but the project
should not build its core DX around them. Cold-start performance and
predictability matter more than clever loader-time behavior.

## 6. `import.meta.main`

`import.meta.main` is documented in the Node v25 ESM API alongside
`import.meta.dirname`, `import.meta.filename`, `import.meta.url`. It returns
`true` when the current module is the entry point.

Useful for self-running test files:

```ts
export function add(a: number, b: number): number {
    return a + b;
}

if (import.meta.main) {
    // run an ad-hoc smoke test when this file is invoked directly
    console.assert(add(1, 2) === 3);
}
```

For Overkill, `import.meta.main` is mainly useful for direct-file workflows and
ad-hoc self-running source files. It should not be taken as proof that full
in-source test support is already solved.

## 7. Watch and reload

Node’s built-in `--watch` is parent-process based. On change:

- In default `--test-isolation=process` mode, Node re-spawns child processes
  per affected test file. This is robust, but pays full process startup per
  re-run.
- In `--test-isolation=none` mode, Node re-evaluates within the same process.
  Faster on small changes, but vulnerable to module-graph staleness because
  Node cannot un-register an already-evaluated module.
- `--watch` itself is filtered out of the flag forwarding to children.

Affected-test rerun is _not_ part of Node’s built-in behavior, and Overkill
should not promise a custom dependency-graph-based watch mode in the core
concept. The default story stays simple: use Node `--watch` and rerun the
selected suite.

## 8. V8 startup snapshots are not part of the settled concept

V8 startup snapshots are a real platform capability, but Overkill should not
commit to them as part of the default architecture.

Why not:

- they add a version-bound build artifact and boot path of their own
- snapshot-safe state is constrained and easy to get subtly wrong
- the concept should not depend on warm-start tactics that still need proof
  on real Overkill workloads

The current concept therefore keeps startup-snapshot work out of the settled
plan. If future measurements show that a snapshot materially improves the
runner without distorting the cold-path story, it can be revisited as an
implementation spike rather than treated as a design commitment today.

## 9. Single-file `.ts` execution today

The minimum invocation in a Node 26-era baseline:

```bash
node ./foo.test.ts
```

That's it. No flag, no `--experimental-*`, no loader. Caveats:

- A self-running Overkill file calls `runIfMain(import.meta, testNode, options?)`.
  `@overkill-dev/test` exposes this as a lazy re-export so imported modules
  return before loading runner config or reporters. Entrypoint modules delegate
  to `@overkill-dev/run`, match the current file to a profile, and use default
  reporters when none are configured.
- The matched profile keeps its configured process model. For supervised and
  worker-pool profiles, the isolated import must export a `testNode` whose
  normalized plan matches the value passed to `runIfMain(...)`.
- Node evaluates the direct entrypoint once before `runIfMain(...)` can create
  an isolation boundary. Use `overkill run <file>` when that bootstrap import
  must also be isolated.
- Files on the native path must use erasable syntax. Non-erasable syntax and
  TSX/JSX require an explicit project transform or precompiled entrypoint.
- ESM extensions: `.ts` is treated as ESM by default if the nearest
  `package.json` has `"type": "module"`, otherwise as CJS. This mirrors `.js`
  behaviour. `.mts` is always ESM, `.cts` always CJS, regardless of
  `package.json`. Overkill should default to `"type": "module"` in scaffolds
  and document `.mts` as the unambiguous explicit form.
- Imports must include the file extension (`./util.ts`, not `./util`). Node’s
  type stripper does not invent extensions and does not consult `tsconfig`’s
  `paths` or `baseUrl`. Use `imports` in `package.json` for path aliases.
- `import type` statements must use the `type` keyword. Otherwise the strip
  leaves a runtime `import` that resolves to a value-less module and fails.

## 10. Fast assertion / equality libraries

Startup is half the story. A runner that boots in 30 ms but pulls in 400 ms of
formatter/diff library on the first failure is still slow to first useful
output.

Notes:

- `pretty-format` and `jest-diff` are the canonical formatters in the Jest /
  Vitest world. Both are sizeable and parse a graph of plugins on import.
  Loading them at the moment of failure (lazy `await import`) keeps the
  success path free.
- Equality / structural diff libraries (e.g. `@vitest/expect`, `dequal`,
  `expect-type`) vary widely. `dequal` is small and synchronous; the Jest
  family is heavier.
- For Overkill, the assertion library should be split into:
  - a tiny core (`assertEqual`, `assertThrows`, value-vs-value comparison,
    strictly typed) loaded eagerly,
  - a deferred presentation layer (pretty-printed diffs, ANSI colour,
    snapshot serializers) imported lazily on first failure or first
    snapshot mismatch.
- Because Overkill builds on [Assertions And Results](../authoring/assertions-and-results.md)’s “tests as values”
  direction, the diff producer never runs unless a result is observed. The
  runner can short-circuit fully when a filter excludes a test.

## 11. Out-of-the-box ideas for fast startup

The optimization target is **cold start**, not warm reuse. A persistent
runner daemon would speed up incremental edits but adds complexity (long-
lived state, socket protocol, lifecycle management) that conflicts with the
minimal direct-file startup principle. Every idea below is consistent with
keeping the cold path short and not requiring a hot daemon to feel fast.

- **Eval-free, no-bundler, no-source-map-rewrite microtest path.** Run
  test files directly through Node's native type stripping; never emit a
  temporary file, never call `vm.runInThisContext`. The simplest path is
  also the fastest.
- **Tests-as-values + explicit lazy execution dependencies.** Evaluate the
  authoritative definition catalog before selection. Expensive body-only
  dependencies may load when selected bodies execute, including explicit
  implementation references across realms. This does not defer test discovery,
  hide constructed nodes, or assume unsupported module syntax.
- **Original-source type analysis.** The optional type-test family analyzes
  the real TypeScript project, retaining compiler programs where reuse is useful.
  Read assertion operands in their original lexical context without temporary
  files, virtual replacement files, or code generation. Reuse public dependency
  APIs where they fit; TypeScript owns language checking. Runtime and compiler
  loops stay independent, and ordinary runtime imports do not load the checker.
  See [Native Type-Test Integration](../authoring/testing-models.md#native-type-test-integration).
- **Pre-resolved file lists.** Save the result of glob expansion (and gitignore
  application) between runs. Re-validate via inotify/FSEvents or a short
  `git status` rather than rewalking the tree.
- **O(1) test-file load.** Reuse ESM module records across runs in the same
  process. Keep the common path focused on module-record reuse and avoid
  inventing custom bytecode-cache layers unless measurement later proves
  they are worth the complexity.
- **Narrow standard-distribution imports.** The root `@overkill-dev/test`
  import is the authoring hot path. It may load default authoring helpers,
  minimal engine construction, and lightweight doubles, but not command
  parsing, configuration loading, reporters, resources, baselines, benchmark
  measurement code, coverage tooling, browser support, or optional adapters.
- **Command-selected modules.** The `overkill` binary should parse argv to the
  command name and `--config`, then load only the selected command
  implementation.
  `overkill run` should not load benchmark measurement or baseline writer
  modules unless the selected command or configuration needs them.
- **Inotify-driven run targeting.** When the watcher fires, classify the
  change (test file / source file / configuration / fixture) and run only the
  relevant subset.
- **No transitive optional-package imports at startup.** Optional packages load
  only through explicit imports, selected configuration values, or selected
  command paths. There is no package scan or dynamic plugin registry on the
  startup path.

## Sources

- [Node.js v25.9.0 — Modules: TypeScript](https://nodejs.org/api/typescript.html)
- [Node.js v25.9.0 — `node:module` API](https://nodejs.org/api/module.html)
- [Node.js v25.9.0 — ECMAScript modules (`import.meta.main`)](https://nodejs.org/api/esm.html)
- [Node.js v25.9.0 — V8 / `v8.startupSnapshot`](https://nodejs.org/api/v8.html)
- [Node.js v25.9.0 — `vm` (createCachedData, SourceTextModule)](https://nodejs.org/api/vm.html)
- [Node.js v25.9.0 — Test runner](https://nodejs.org/api/test.html)
- [nodejs/amaro on GitHub](https://github.com/nodejs/amaro)
- [InfoQ — Node.js Moves Toward Stable TypeScript Support With Amaro 1.0](https://www.infoq.com/news/2025/08/node-amaro-stable-ts-support/)
- [Socket.dev — Node.js Moves Toward Stable TypeScript Support with Amaro 1.0](https://socket.dev/blog/node-js-moves-toward-stable-typescript-support-with-amaro-1-0)
- [nodejs/node PR #55698 — `module.registerHooks()`](https://github.com/nodejs/node/pull/55698)
- [nodejs/node Issue #56241 — `module.registerHooks()` tracking](https://github.com/nodejs/node/issues/56241)
- [nodejs/node Discussion #51661 — Customization hook overhead](https://github.com/orgs/nodejs/discussions/51661)
- [Quaxel (Medium) — ESM Loader Hooks Can Quietly Wreck Startup (Mar 2026)](https://medium.com/@Quaxel/esm-loader-hooks-can-quietly-wreck-startup-b6fa96be8629)
- [V8 Blog — Custom startup snapshots](https://v8.dev/blog/custom-startup-snapshots)
- [Joyee Cheung — Reproducible Node.js built-in snapshots, part 2](https://joyeecheung.github.io/blog/2024/09/28/reproducible-nodejs-builtin-snapshots-2/)
- [Joyee Cheung — Reproducible Node.js built-in snapshots, part 3](https://joyeecheung.github.io/blog/2024/09/28/reproducible-nodejs-builtin-snapshots-3/)
- [Joyee Cheung — Fixing Node.js vm APIs, part 4](https://joyeecheung.github.io/blog/2023/12/31/fixing-nodejs-vm-apis-4/)
- [nodejs/single-executable Discussion #57 — V8 snapshots in SEA](https://github.com/nodejs/single-executable/discussions/57)
- [nodejs/node commit 966b700 — ESM code cache for SEA](https://github.com/nodejs/node/commit/966b700623)
- [Sebastian Staffa — A look at native TypeScript performance (Feb 2025)](https://sebastian-staffa.eu/posts/nodejs-native-ts-benchmark/)
- [PkgPulse — tsx vs ts-node vs Bun (2026)](https://www.pkgpulse.com/blog/tsx-vs-ts-node-vs-bun-2026)
- [Bolder Apps — Node.js vs Bun vs Deno performance showdown (2026)](https://www.bolderapps.com/blog-posts/node-js-vs-bun-vs-deno-the-ultimate-runtime-performance-showdown)
- [Visual Studio Magazine — TypeScript 5.9 RC: Import Defer](https://visualstudiomagazine.com/articles/2025/07/25/typescript-59-rc-brings-deferred-imports-nodejs-20-module-target.aspx)
- [The Dev Newsletter — State of TypeScript 2026](https://devnewsletter.com/p/state-of-typescript-2026/)
- [Bolder Apps — Node.js in 2026: The "Native-First" Revolution](https://www.bolderapps.com/blog-posts/node-js-in-2026-the-native-first-revolution-and-the-end-of-dependency-hell)
- [SitePoint — Vitest vs Jest 2026](https://www.sitepoint.com/vitest-vs-jest-2026-migration-benchmark/)
