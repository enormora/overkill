# `@overkill-dev/stryker-runner`

Optional first-party Stryker `TestRunner` plugin for Node microtest profiles.
Profile initialization prepares the mutation execution policy. Dry runs, mutant
execution, and capability reporting are not implemented yet.

```js
export default {
    testRunner: 'overkill',
    plugins: [ '@overkill-dev/stryker-runner' ],
    overkill: {
        configPath: 'overkill.config.ts',
        profile: 'unit-fast'
    }
};
```

Omit `configPath` or set it to `null` for normal Overkill config discovery from
the Stryker worker's cwd. Omit `profile` or set it to `null` to infer the sole
microtest profile in the normalized registry. The built-in `microtest` fallback
counts: adding a custom microtest profile normally requires an explicit name.
An explicitly configured `microtest` profile replaces that fallback.

Unknown names, non-microtest profiles, absent eligible profiles, ambiguous
inference, and malformed settings fail before discovery or test imports.
Browser-oriented integration profiles and multi-profile selections are rejected.
Other profile families may coexist in the project registry. Profile names do not
determine eligibility. Incompatible test nodes are checked during collection.

Initialization prepares a public runner command with explicit serial scheduling,
ordinary V8 coverage disabled, and baseline updates disabled. Microtest profiles
have no Overkill retry policy. Discovery, loaders, capability restrictions,
resource policies, timeouts, and the configured process model are preserved.
The original profile remains unchanged; the command records the override as
`request.execution: { mode: 'serial' }`.

Initialization imports no test modules. Repeated initialization shares one
result, including failures. Campaign policy freezing and invocation execution
are not implemented yet.
