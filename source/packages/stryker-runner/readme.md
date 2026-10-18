# `@overkill-dev/stryker-runner`

Optional first-party Stryker `TestRunner` plugin for Node microtest profiles.
Supports dry runs, instrumented mutant coverage, filtered mutant runs, bail,
deadlines, and environment reload reporting with Stryker `10.0.0`.
Initialization freezes the mutation execution policy before importing tests.

```js
export default {
    testRunner: 'overkill',
    plugins: [ '@overkill-dev/stryker-runner' ],
    overkill: {
        configPath: 'overkill.config.ts',
        profile: 'unit-fast',
        paths: [],
        freshState: false
    }
};
```

Omit `configPath` or set it to `null` for normal Overkill config discovery from
the Stryker worker's cwd. Omit `profile` or set it to `null` to infer the sole
microtest profile in the normalized registry. The built-in `microtest` fallback
counts: adding a custom microtest profile normally requires an explicit name.
An explicitly configured `microtest` profile replaces that fallback.

`paths` supplies explicit files or directory filters using ordinary runner
discovery rules. It defaults to `[]`. Initialization requires discovered files;
without a config discovery policy, provide explicit files through `paths`.

Unknown names, non-microtest profiles, absent eligible profiles, ambiguous
inference, and malformed settings fail before discovery or test imports.
Browser-oriented integration profiles and multi-profile selections are rejected.
Other profile families may coexist in the project registry. Profile names do not
determine eligibility. Incompatible test nodes are checked during collection.

Initialization freezes a public runner policy with explicit serial scheduling,
ordinary V8 coverage disabled, and baseline updates disabled. Microtest profiles
have no Overkill retry policy. Discovery, loaders, capability restrictions,
process usage policies, timeouts, and the configured process model are preserved.
The original profile remains unchanged; the command records the override as
`request.execution: { mode: 'serial' }`.

Each plugin worker requests policy once from a fresh, unmutated process owned
by Stryker's main process. It imports user configuration and its dependencies,
discovers files, and returns immutable policy data. It imports no tests or
custom engines. It is terminated and reaped after success, failure, or disposal.
User configuration does not enter the plugin worker's execution graph during
initialization.
Repeated initialization shares one result, including failures. Replacement
workers resolve policy independently.

Stryker owns mutation selection. Exclude configuration, test definitions,
definition helpers such as macros and suite fragments, and adapter code through
`mutate`, while keeping those files available in the sandbox. Use mutation
exclusions rather than `ignorePatterns`, which removes files from the sandbox.
Prefer a production-only include, with exclusions where production and test
definitions share directories.

Initialization rejects targets overlapping the loaded config entry, discovered
test modules, or the executing adapter directory. Boolean targets and mutation
ranges are both checked. Imported definition helpers require project-owned
exclusions; initialization does not import tests or build an import graph to
classify them. Installed adapter code is normally outside Stryker's targets.

The plugin captures the launch cwd during loading, before Stryker changes the
worker cwd. Original absolute `configPath` and `paths` inputs are rebased to
sandbox copies; relative and already-sandboxed paths remain sandbox-local.
Missing copies fail without loading originals. File identities remain canonical
project-relative paths across sandbox names and replacement workers.

Mutation policy carries an additional native module boundary. Configuration
dependencies and test imports must resolve inside the sandbox or trusted
installed dependency and bootstrap roots. Absolute project imports and symlinks
escaping those roots fail before evaluation. Shared roots overlapping original
project files are rejected; load the adapter from a separate installed package.
The same boundary applies during config revalidation and both runner process
models without widening capability permissions or resetting module caches.

Execution hosts revalidate file-backed configuration before collecting tests.
Changes to authoritative discovery, loader declarations, selection, permissions,
execution, or resources fail even when test identities would remain unchanged.
Reporters, valid unrelated profiles, disabled coverage settings, and overridden
scheduling do not affect the comparison.

The execution session runs serial cases in the selected profile's process
model. `freshState` defaults to `false`: in-process execution retains its collected
plan and transitive module state inside Stryker's reusable plugin worker. Suites
must support repeated execution. Persistent memoization, singleton state, and
caches populated during collection or a dry run can hide runtime mutations.

Set `freshState: true` to start a new invocation process, collect the complete
eligible plan, and execute the requested selection for every invocation. This
resets transitive ESM and CommonJS modules, globals, and process-local mutable
state at the cost of startup and collection. It does not reset files, databases,
or external services. In-process permission enforcement remains best effort.
Supervised profiles already use one fresh restricted child per invocation;
`freshState` adds no extra host or stronger permissions there.

| Execution              | `reloadEnvironment` |
| ---------------------- | ------------------- |
| Reused in-process ESM  | `false`             |
| Fresh in-process state | `true`              |
| Supervised process     | `true`              |

Stryker replaces reused workers for requested reloads and static-mutant
transitions. Direct reload requests against an already loaded native ESM graph
return `Error`. Static activation precedes configuration revalidation and test
imports; runtime activation follows unmutated collection.

An automatic IPC receiver in Stryker's main process retains the original dry-run
catalog and coverage across workers and replacements. No additional dry run,
reporter, launcher, or disk manifest is required. Fresh invocation hosts and
supervised children belong to that main process. Worker disconnects cancel
their execution and reap the children. The receiver uses Stryker `10.0.0`'s
worker marker and generated schema defaults; its sockets do not keep Node alive.

Test IDs encode the complete structured work identity, including parameter keys
and distinct resource-free runtime variants. Authored suite and case titles
remain identity components, with suite segments kept separate. Rendered names
and source line or column positions do not determine IDs.
File origins use project-relative paths with forward slashes. Absolute sandbox
paths, dot segments, and separator aliases normalize to the same origin;
origins outside the sandbox or naming its root fail. Existing canonical IDs
retain their encoding. Regenerate cached Stryker reports if they contain IDs
derived from noncanonical path spellings.

Every fresh collection validates the complete eligible catalog, selection
metadata, and intentional skips before narrowing. Unknown IDs, catalog drift,
unexpected skips, and empty mutant filters return `Error`. The adapter expands
Stryker's sandbox file filters.

Set Stryker's `coverageAnalysis` to `perTest` (the normal optimized mode), `all`,
or `off`. `perTest` returns Stryker's case counters and narrows execution only
when the requested cases include every recorded covering case. `all` returns
aggregate mutant counts and selects the full eligible suite. `off` omits mutant
coverage and also selects the full eligible suite. Ordinary V8 coverage remains
disabled in every mode.

Static coverage or uncertain attribution widens valid filters to the complete
dry-run catalog, preserving its original file restrictions. The adapter never
infers `NoCoverage`. Missing or malformed counter transport, incomplete
test results, unknown IDs, duplicate IDs, and explicit-empty filters return
`Error`. A test that touches no instrumented code needs no counter bucket.
Stryker can still classify genuinely uncovered mutants from complete coverage.

Stryker's explicit `ignoreStatic` setting retains its runtime-only behavior for
hybrid mutants and its own handling of static mutants. Otherwise recorded
import-time hits require static activation before user imports. Existing reload
checks reject a loaded graph that cannot perform that activation safely.
Fallback keeps Stryker's deadline and bail policy. The dry-run coverage mode is
fixed with the campaign baseline and retained across worker replacements.

Counters retain their object identity across reused invocations. Test attribution
includes awaited cleanup. Infrastructure errors take precedence over timeouts
and confirmed kills; swallowed hit-limit exceptions still return `Timeout`.
Each invocation clears prior counters before collection. Activation, test identity,
hit-limit state, and the activation environment variable are cleared on exit,
including partial setup failures. Reset failures still attempt independent cleanup
and return `Error` if state cannot be cleared; retained runtime objects are never
replaced to recover. Detached result counters remain available after cleanup.
Ordinary reporters, records, duration history, V8 coverage, and artifact-file
persistence are disabled for these memory-only execution sessions.

Every invocation gets fresh scopes, observers, cleanup, and results. Failed
collection remains cached in reused mode; fresh mode can collect again on the
next invocation. Fresh hosts terminate before their invocation settles.

Disposal closes admission immediately. It cancels and awaits supervised child
termination, terminates fresh invocation hosts, or awaits active reused
in-process work without terminating Stryker's worker.

`overkill.seed` accepts a nonnegative decimal string, for example `'42'`.
Stryker applies a generated schema default before distributing configuration;
dry runs, mutants, workers, replacements, and fresh hosts use that same seed.
The adapter logs it through Stryker during initialization. Supply the logged
value explicitly to reproduce ordering. Multiple programmatic campaigns in one
Node process may share the generated schema default. Worker settings require the
coordinator-resolved seed and never substitute another seed when it is missing.
