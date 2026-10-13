# `@overkill-dev/stryker-runner`

Optional first-party Stryker `TestRunner` plugin for Node microtest profiles.
Profile initialization freezes the mutation execution policy and owns a private
execution session. Stryker dry runs, mutant execution, and capability reporting
are not implemented yet.

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

Each plugin worker resolves policy once in a fresh, unmutated process. That
process imports user configuration and its dependencies, discovers files, and
returns immutable policy data. It imports no tests or custom engines and is
terminated and reaped after success, failure, or disposal. User configuration
does not enter the plugin worker's execution graph during initialization.
Repeated initialization shares one result, including failures. Replacement
workers resolve independently; this is not shared campaign coordination.

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

The private session executes serial cases in the selected profile's process
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
