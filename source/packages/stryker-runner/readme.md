# `@overkill-dev/stryker-runner`

Optional first-party Stryker `TestRunner` plugin for Node microtest profiles.
Profile initialization freezes the mutation execution policy. Dry runs, mutant
execution, and capability reporting are not implemented yet.

```js
export default {
    testRunner: 'overkill',
    plugins: [ '@overkill-dev/stryker-runner' ],
    overkill: {
        configPath: 'overkill.config.ts',
        profile: 'unit-fast',
        paths: []
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
resource policies, timeouts, and the configured process model are preserved.
The original profile remains unchanged; the command records the override as
`request.execution: { mode: 'serial' }`.

Each plugin worker resolves policy once in a fresh, unmutated process. That
process imports user configuration and its dependencies, discovers files, and
returns immutable policy data. It imports no tests or custom engines and is
terminated and reaped after success, failure, or disposal. User configuration
does not enter the plugin worker's execution graph during initialization.
Repeated initialization shares one result, including failures. Replacement
workers resolve independently; this is not shared campaign coordination.

Execution hosts revalidate file-backed configuration before collecting tests.
Changes to authoritative discovery, loader declarations, selection, permissions,
execution, or resources fail even when test identities would remain unchanged.
Reporters, valid unrelated profiles, disabled coverage settings, and overridden
scheduling do not affect the comparison. Invocation execution is not implemented
in this adapter yet.
