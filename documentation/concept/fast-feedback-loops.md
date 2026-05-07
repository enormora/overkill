# Fast Feedback Loops

## Purpose

Overkill treats sub-second feedback as a first-class design constraint, not a future
optimization. A test runner that takes 5 seconds to compile, initialize and bootstrap
before running 500 tests in under a second is the wrong shape. The user will, in
practice, run the suite less often, lose trust in the inner loop, and stop relying on
tests as a thinking tool.

This document captures the concrete engineering knobs available in modern Node 26-era runtimes (May 2026)
that a test runner can pull _today_ to keep the cold path short and the hot path
sharable. Companion to `platform-first-implementation-notes.md` and
`bundles-and-distribution.md`.

The investigation is structured around twelve technical areas; each section is
deliberately concrete so it can be turned into an issue or RFC without further
research.

## 1. Node native type stripping (Node 26-era baseline)

Status as of May 2026:

-   `--experimental-strip-types` was unflagged by default in Node 22.18.0 / 23.6.0.
-   Type stripping was marked **stable** in Node 24.3.0 (and 22.18.0 LTS) and
    promoted in the v25.2.0 release notes (Nov 2025). No experimental warning is
    emitted.
-   `--experimental-transform-types` is still flagged. It enables `enum`,
    `namespace`, parameter properties (`constructor(private foo: T)`), import
    elision rewrites and JSX/TSX transformation.
-   `--no-strip-types` disables the feature.
-   Decorators are TC39 Stage 3, not yet implemented in V8, and currently a parser
    error in Node’s type stripper. Node will not transform them until the runtime
    natively supports decorators.
-   Files inside `node_modules` are _not_ stripped by default. Only the top-level
    application graph is.
-   Node intentionally ignores `tsconfig.json` at runtime. There is no path to
    configure TS semantics through Node.

Performance characteristics:

-   The transformer is `amaro`, which wraps `@swc/wasm-typescript`. Whitespace-
    preserving stripping makes source maps unnecessary for line-accurate stack
    traces in the strip-only mode.
-   Per-file overhead is approximately on par with native SWC (single-digit ms on
    typical files), and an order of magnitude faster than `tsc` and faster than
    the full esbuild parse + emit, because no JS AST is reconstructed for
    erasable syntax.
-   Node v24+ ships a **module compile cache** (`require(esm)` related work) that
    caches V8 bytecode. It does **not** cache the strip output. A test runner can
    layer its own per-file strip cache keyed by `(absolute path, mtime, size, amaro version)` to avoid repeating the WASM call on warm runs.

Practical bottom line for Overkill:

-   Strip-only mode is the default fast path. The `node test/foo.test.ts`
    invocation works directly; no loader required.
-   For any code that uses enums, parameter properties, namespaces or JSX, Overkill
    must either flag the file (a lint or fail-fast diagnostic) or fall through to
    a transform path. Most modern TS code is already erasable, especially after
    the `--erasableSyntaxOnly` tsc check landed in TS 5.8.

## 2. Node Built-Ins First

The current concept should stay conservative here:

-   prefer Node’s native type stripping
-   prefer Node’s native watch mode
-   avoid custom loader hooks in the default story
-   avoid building a bespoke module graph or runner daemon as part of the
    core feedback-loop promise

External tools may still matter for edge cases, but the baseline concept
should not assume an Overkill-owned loader pipeline.

## 3. TS execution alternatives — concrete startup numbers

Approximate cold-start of a single trivial `.ts` file (2026 measurements, modern
laptop, no network):

| Runner                                    | Startup      | Notes                                             |
| ----------------------------------------- | ------------ | ------------------------------------------------- |
| `bun ./foo.test.ts`                       | ~8–15 ms     | JavaScriptCore, full TS (enums, decorators, JSX). |
| `deno test foo.test.ts`                   | ~30–60 ms    | V8 + native TS, full syntax.                      |
| `node ./foo.test.ts` (native strip)       | ~40–60 ms    | Erasable syntax only.                             |
| `tsx ./foo.test.ts`                       | ~60–80 ms    | esbuild transform on top of Node startup.         |
| `node --import @swc-node/register foo.ts` | ~80–100 ms   | SWC native binary.                                |
| `ts-node --swc foo.ts`                    | ~150–200 ms  | SWC + ts-node bookkeeping.                        |
| `ts-node --transpileOnly foo.ts`          | ~250–400 ms  | TypeScript compiler, no checking.                 |
| `ts-node foo.ts`                          | ~600–1500 ms | Full type checking.                               |

Two consequences:

-   The native Node path is within a small constant factor of Bun for cold
    `.ts` execution and is the right baseline for Overkill, given the
    platform-first stance.
-   Anything that requires `tsx`, `ts-node` or a bundled CLI is already in the
    “noticeable warm-up” bucket Overkill wants to avoid.

## 4. Sharing parsed sources between tests in the same process

Inside a single Node process:

-   Node’s ESM loader already caches modules by canonical URL. Once a `.ts` file
    is stripped and compiled, importing it again from another test module is
    free: same module record, same exports, no re-parse.
-   Across processes, Node's module compile cache (stable since 24.x) handles
    bytecode reuse on the user's behalf for `require()` and `import` of `.js`.
    The cache directory can be steered via `NODE_COMPILE_CACHE`. Lower-level
    `vm.Script#createCachedData()` and `vm.SourceTextModule#createCachedData()`
    exist for advanced cases but are not needed in the common path.
-   The strip output itself is not cached across processes by Node. The
    per-file strip cost is single-digit milliseconds; in practice the compile
    cache plus in-memory module cache cover the common case.
-   Detecting that strip-only failed is straightforward: `amaro.transformSync`
    throws a structured parser error indicating non-erasable syntax. The runner
    can catch, fall through to transform mode, and surface a one-time hint
    (“this file uses enums; switching to transform”).

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

-   In default `--test-isolation=process` mode, Node re-spawns child processes
    per affected test file. This is robust, but pays full process startup per
    re-run.
-   In `--test-isolation=none` mode, Node re-evaluates within the same process.
    Faster on small changes, but vulnerable to module-graph staleness because
    Node cannot un-register an already-evaluated module.
-   `--watch` itself is filtered out of the flag forwarding to children.

Affected-test rerun is _not_ part of Node’s built-in behavior, and Overkill
should not promise a custom dependency-graph-based watch mode in the core
concept. The default story stays simple: use Node `--watch` and rerun the
selected suite.

## 8. V8 startup snapshots and the `<50 ms cold start` target

V8 snapshot tooling available today:

-   `node --snapshot-blob out.blob --build-snapshot entry.js` builds a custom
    startup snapshot.
-   `node --snapshot-blob out.blob` launches a process pre-initialized from the
    snapshot. Reported context-creation cost drops from ~40 ms to <2 ms on
    desktop, ~270 ms to ~10 ms on phones (V8 blog).
-   `v8.startupSnapshot.{addSerializeCallback, addDeserializeCallback, setDeserializeMainFunction, isBuildingSnapshot}` lets the snapshotted code
    rehydrate state on launch.
-   ESM code cache for SEA (single-executable apps) landed in 2026 (commit
    `966b700`).

Limitations that matter for a test runner:

-   Only a subset of built-ins is snapshot-safe. `Math.random` and `Date.now`
    captured at snapshot time become fixed in the snapshot, requiring explicit
    rehydration.
-   Snapshots are V8-version-bound: must be regenerated per Node binary
    upgrade.
-   `createSnapshot` is destructive in Node mode (the environment is consumed).
    The build step has to be a separate process.

A concrete plan for Overkill:

-   Ship a build step that creates a `overkill.snapshot.blob` containing the
    runner core, reporter, default assertion library, plugin registry, and
    pre-resolved file lists. Save it in `~/.cache/overkill/snapshots/<hash>.blob`,
    keyed by `(node version, overkill version, plugin set hash)`.
-   `overkill run` launches via `node --snapshot-blob …`. Cold start of the
    runner itself (before user code) becomes a few milliseconds.
-   Combined with a per-file ESM `vm.SourceTextModule#cachedData` cache for the
    user’s test files, total time-to-first-test in the 30–50 ms range is
    realistic on warm caches.

Reproducibility note: V8 requires `--random_seed=42` (or any fixed value) and
careful flag matching for the code cache to be accepted; Joyee Cheung’s blog
series documents the exact set.

## 9. Single-file `.ts` execution today

The minimum invocation in a Node 26-era baseline:

```bash
node ./foo.test.ts
```

That’s it. No flag, no `--experimental-*`, no loader. Caveats:

-   Files must use erasable syntax. Otherwise: `node --experimental-transform-types ./foo.test.ts`.
-   ESM extensions: `.ts` is treated as ESM by default if the nearest
    `package.json` has `"type": "module"`, otherwise as CJS. This mirrors `.js`
    behaviour. `.mts` is always ESM, `.cts` always CJS, regardless of
    `package.json`. Overkill should default to `"type": "module"` in scaffolds
    and document `.mts` as the unambiguous explicit form.
-   Imports must include the file extension (`./util.ts`, not `./util`). Node’s
    type stripper does not invent extensions and does not consult `tsconfig`’s
    `paths` or `baseUrl`. Use `imports` in `package.json` for path aliases.
-   `import type` statements must use the `type` keyword. Otherwise the strip
    leaves a runtime `import` that resolves to a value-less module and fails.

## 10. Fast assertion / equality libraries

Startup is half the story. A runner that boots in 30 ms but pulls in 400 ms of
formatter/diff library on the first failure is still slow to first useful
output.

Notes:

-   `pretty-format` and `jest-diff` are the canonical formatters in the Jest /
    Vitest world. Both are sizeable and parse a graph of plugins on import.
    Loading them at the moment of failure (lazy `await import`) keeps the
    success path free.
-   Equality / structural diff libraries (e.g. `@vitest/expect`, `dequal`,
    `expect-type`) vary widely. `dequal` is small and synchronous; the Jest
    family is heavier.
-   For Overkill, the assertion library should be split into:
    -   a tiny core (`assertEqual`, `assertThrows`, value-vs-value comparison,
        strictly typed) loaded eagerly,
    -   a deferred presentation layer (pretty-printed diffs, ANSI colour,
        snapshot serializers) imported lazily on first failure or first
        snapshot mismatch.
-   Because Overkill builds on `assertions-and-results.md`’s “tests as values”
    direction, the diff producer never runs unless a result is observed. The
    runner can short-circuit fully when a filter excludes a test.

## 11. Out-of-the-box ideas for fast startup

The optimization target is **cold start**, not warm reuse. A persistent
runner daemon would speed up incremental edits but adds complexity (long-
lived state, socket protocol, lifecycle management) that conflicts with the
"just `node ./foo.test.ts`" principle. Every idea below is consistent with
keeping the cold path short and not requiring a hot daemon to feel fast.

-   **V8 startup snapshot of the runner.** As described in section 8, ship a
    pre-warmed engine snapshot for the runner itself. Cold start under
    50 ms is realistic.
-   **Eval-free, no-bundler, no-source-map-rewrite microtest path.** Run
    test files directly through Node's native type stripping; never emit a
    temporary file, never call `vm.runInThisContext`. The simplest path is
    also the fastest.
-   **Tests-as-values + lazy-shake.** Tests are described as data structures
    rather than registered side-effectfully via `it()`. Combined with
    `import defer` (TC39 Stage 3, supported syntactically by TypeScript 5.9 and
    via `acorn-import-defer` in Webpack; not yet native in V8 / Node) the
    runner can avoid evaluating the import graph of unselected tests. Until
    Node ships native `import defer`, Overkill can simulate the effect by
    keeping each test in its own module and lazy-importing on demand.
-   **Type-test integration via tstyche.** Type tests need a real `tsc`.
    Overkill should not reimplement that loop. Integrate with
    [tstyche](https://tstyche.org/), which already runs type tests with its
    own incremental cache, and surface its results through the Overkill
    reporter pipeline. The runtime test loop and the type-test loop stay
    independent without Overkill owning a compile server.
-   **Pre-resolved file lists.** Save the result of glob expansion (and gitignore
    application) between runs. Re-validate via inotify/FSEvents or a short
    `git status` rather than rewalking the tree.
-   **O(1) test-file load.** Reuse ESM module records across runs in the same
    process. With `vm.SourceTextModule#cachedData`, even cross-process reuse
    is cheap. Combine with content-hash keys to avoid `require.cache`-class
    staleness bugs.
-   **Strip cache on disk.** Persist amaro’s output keyed by file hash + amaro
    version. The strip itself is a few ms per file but adds up to seconds in
    larger graphs; this cache keeps warm runs effectively zero.
-   **Inotify-driven run targeting.** When the watcher fires, classify the
    change (test file / source file / config / fixture) and run only the
    relevant subset.
-   **No transitive plugin imports at startup.** Plugin manifests register
    capabilities lazily; their implementation modules import only when a test
    actually uses them. The runner core imports nothing per-plugin until the
    first plugin call.

## Sources

-   [Node.js v25.9.0 — Modules: TypeScript](https://nodejs.org/api/typescript.html)
-   [Node.js v25.9.0 — `node:module` API](https://nodejs.org/api/module.html)
-   [Node.js v25.9.0 — ECMAScript modules (`import.meta.main`)](https://nodejs.org/api/esm.html)
-   [Node.js v25.9.0 — V8 / `v8.startupSnapshot`](https://nodejs.org/api/v8.html)
-   [Node.js v25.9.0 — `vm` (createCachedData, SourceTextModule)](https://nodejs.org/api/vm.html)
-   [Node.js v25.9.0 — Test runner](https://nodejs.org/api/test.html)
-   [nodejs/amaro on GitHub](https://github.com/nodejs/amaro)
-   [InfoQ — Node.js Moves Toward Stable TypeScript Support With Amaro 1.0](https://www.infoq.com/news/2025/08/node-amaro-stable-ts-support/)
-   [Socket.dev — Node.js Moves Toward Stable TypeScript Support with Amaro 1.0](https://socket.dev/blog/node-js-moves-toward-stable-typescript-support-with-amaro-1-0)
-   [nodejs/node PR #55698 — `module.registerHooks()`](https://github.com/nodejs/node/pull/55698)
-   [nodejs/node Issue #56241 — `module.registerHooks()` tracking](https://github.com/nodejs/node/issues/56241)
-   [nodejs/node Discussion #51661 — Customization hook overhead](https://github.com/orgs/nodejs/discussions/51661)
-   [Quaxel (Medium) — ESM Loader Hooks Can Quietly Wreck Startup (Mar 2026)](https://medium.com/@Quaxel/esm-loader-hooks-can-quietly-wreck-startup-b6fa96be8629)
-   [V8 Blog — Custom startup snapshots](https://v8.dev/blog/custom-startup-snapshots)
-   [Joyee Cheung — Reproducible Node.js built-in snapshots, part 2](https://joyeecheung.github.io/blog/2024/09/28/reproducible-nodejs-builtin-snapshots-2/)
-   [Joyee Cheung — Reproducible Node.js built-in snapshots, part 3](https://joyeecheung.github.io/blog/2024/09/28/reproducible-nodejs-builtin-snapshots-3/)
-   [Joyee Cheung — Fixing Node.js vm APIs, part 4](https://joyeecheung.github.io/blog/2023/12/31/fixing-nodejs-vm-apis-4/)
-   [nodejs/single-executable Discussion #57 — V8 snapshots in SEA](https://github.com/nodejs/single-executable/discussions/57)
-   [nodejs/node commit 966b700 — ESM code cache for SEA](https://github.com/nodejs/node/commit/966b700623)
-   [Sebastian Staffa — A look at native TypeScript performance (Feb 2025)](https://sebastian-staffa.eu/posts/nodejs-native-ts-benchmark/)
-   [PkgPulse — tsx vs ts-node vs Bun (2026)](https://www.pkgpulse.com/blog/tsx-vs-ts-node-vs-bun-2026)
-   [Bolder Apps — Node.js vs Bun vs Deno performance showdown (2026)](https://www.bolderapps.com/blog-posts/node-js-vs-bun-vs-deno-the-ultimate-runtime-performance-showdown)
-   [Visual Studio Magazine — TypeScript 5.9 RC: Import Defer](https://visualstudiomagazine.com/articles/2025/07/25/typescript-59-rc-brings-deferred-imports-nodejs-20-module-target.aspx)
-   [The Dev Newsletter — State of TypeScript 2026](https://devnewsletter.com/p/state-of-typescript-2026/)
-   [Bolder Apps — Node.js in 2026: The "Native-First" Revolution](https://www.bolderapps.com/blog-posts/node-js-in-2026-the-native-first-revolution-and-the-end-of-dependency-hell)
-   [SitePoint — Vitest vs Jest 2026](https://www.sitepoint.com/vitest-vs-jest-2026-migration-benchmark/)
