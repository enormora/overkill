# Repository Layout

Overkill uses a feature-oriented monorepo layout.

```text
source/
|-- config/                  # shared project policy, loading, normalization, and profile file evaluation
|-- engine/                  # current engine-owned runtime, contracts, core execution code
|-- integration-tests/       # integration tests outside the unit-test suite
|-- reporters/               # current concrete reporter implementations
|-- authoring/               # shared ordinary test-node constructors
|-- runtimes/                # future shared resource/runtime code
|-- feature-a/               # generic example of a reusable feature folder
`-- packages/
    |-- engine/
    |   `-- engine.entry-point.ts   # thin facade for the published @overkill-dev/engine package
    `-- package-a/
        `-- package-a.entry-point.ts   # generic example of a publish facade re-exporting feature code
```

Rules:

- Shared feature folders are the source of truth.
- Published packages are assembled by `packtory` from facade entry points in `source/packages/**`.
- `just compile` separates production package output (`target/package-build/source`) from compiled tests (`target/build/source`). Package analysis uses only production output.
- `just test-mutation-integration` checks source mutation integration. `just test-mutation-package-smoke` checks packed Stryker packages. The full integration and package smoke recipes include the same scenarios.
- Production and browser builds skip dependency declaration checks while retaining strict checks for project code.
- Register dynamically loaded runner modules as private roots in `packtory.config.js` to preserve their runtime exports.
- Adding a package should usually mean adding a small facade first, not creating a new isolated source tree.
- A package facade should mainly re-export or lightly adapt code from shared feature folders.

## Mutation validation

- `just test-mutation-integration` compares real Stryker campaigns using `perTest`, `all`, and `off`, both process models, and both fresh-state settings. Controlled suites run twice with each fixed campaign seed. A separate cache regression demonstrates the reused-state limitation.
- `just test-mutation-package-smoke` repeats the accuracy comparison through packed public packages.
- CI checks two-sample source cost measurements on the small workload. `just benchmark-mutation-cost` compiles the checkout, records five samples for both workloads, and writes `target/mutation-cost/report.html`, including raw evidence and host metadata.

Campaign measurements include Stryker's actual reload behavior. Full-suite modes can require worker replacement, so campaign times do not isolate reuse savings. Public execution-session measurements separately compare first collection, subsequent plan access, case execution, invocation completion, and disposal. Only reused in-process sessions retain a host; supervised sessions create a fresh host for each invocation. Driver startup and fresh-host bootstrap have separate clock boundaries; their durations are not additive.

Cost workloads contain one file with two cases or two files with four cases each. Every sample starts a new validation driver. Campaign samples mutate one fixed subject; session samples execute an initial and a subsequent invocation. This bounds each sample's work within the runner's existing case deadline. Graph identities verify reuse or recollection without enabling forbidden capabilities. Reports label source versus compiled checkout measurements and record the Node version, without calibration or speed thresholds. Budgets check observed completion counts; time metrics remain diagnostic.
