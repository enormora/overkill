# Overkill

Overkill is a test authoring and runner toolkit for explicit, composable test
trees.

Install the standard distribution:

```sh
npm install -D @overkill-dev/test
```

The `@overkill-dev/test` package ships the public `overkill` binary and the
default authoring facade. See
[`source/packages/test/readme.md`](source/packages/test/readme.md) for the
quickstart and package surface.

Repository tests use the published `@overkill-dev/test` authoring API and
`overkill` CLI. It is the repository's only direct Overkill dependency.
Profiles in `overkill.config.js` select each suite. Package smoke
tests import their outer authoring API through `#tests` so it resolves from the
repository dependencies while consumer checks use the freshly packed packages.
Leaf-package checks require exports from that packed consumer installation.
Imports for the code under test continue to target source modules. Engine
singletons are scoped to compatible execution protocols, so the checkout can
exercise its implementation alongside the published distribution.
Tests of unmanaged engine execution use `runWithAttachmentContext(null, ...)`
to isolate it from the integration runner's attachment context.

## Repository checks

CI runs four categories of tests:

- Unit tests: `npx just test-unit-with-coverage`. This is the only unit run in CI.
  Overkill coverage includes production code under `source`, including `source/packages`,
  and excludes `*.entry-point.ts`, tests, fixtures, and test support. TypeScript
  files with no executable code are omitted from runtime coverage. The coverage
  recipe grants Node's inspector capability for V8 collection in audit mode.
- Integration tests: `npx just test-integration`. The suite in
  `source/integration-tests/repository.test.ts` owns tests that use real files,
  processes, compiler projects, or external execution boundaries. These tests
  do not contribute to unit coverage. The command also runs the
  `mutationCampaigns` profile with a separate budget for its subprocess matrix.
  `npx just test-process-integration` runs
  the process suite on Linux and macOS.
- Type tests: `npx just test-types`, for compile-time public API assertions.
- Package smoke tests: `npx just test-package-smoke`, for installed exports,
  declarations, CLI startup, and interoperability across package boundaries.
  These are integration tests in the `packageSmoke` profile. The published
  runner executes them against packages freshly packed from this checkout.
  The Stryker smoke test runs one mutant against a one-line module; campaign
  matrices run in the `mutationCampaigns` profile.
  Publication dry runs execute as a separate CI job alongside package smoke tests.

Integration, process, compiler, package-smoke, and benchmark recipes invoke the
published CLI with Node so audit flags do not propagate into consumer processes.

Use `npx just test-unit` for a local unit run without coverage. Keep integration
test nodes out of the unit aggregation rooted at `source/overkill.test.ts`.
Tests of property, benchmark, and mutation support are ordinary unit or
integration tests of those features. `npx just benchmark-mutation-cost` runs the
benchmark profile through the published CLI. CI does not run a mutation-score or
performance-regression gate for the repository.

Use tables for case matrices, macros for reusable node factories, and custom
assertions for shared domain checks. Test doubles and transcripts come from
`@overkill-dev/test`; keep source imports when those APIs are the subject of a
test. Integration fixtures can bind resources through
`@overkill-dev/test/resources`. Microtests keep setup in memory and use scope
methods for async checkpoints and cleanup.

Compilation and static analysis are separate checks. Unit and integration tests
share one TypeScript compilation project. CI deliberately starts ESLint without
a restored cache and reports its most expensive rules. Use `npx just eslint`
to run the same checks locally.

## ESLint testing

Install `@overkill-dev/eslint-test` to share rule definitions and named
configuration matrices between example suites and automated source/option
properties. Configuration tests add inventories, resolved policy checks, project
fixtures, and generated safety properties. See the [package documentation](source/packages/eslint-test/readme.md).

## Differential testing

Install `@overkill-dev/differential` alongside `@overkill-dev/test`.
Use `differential({ implementations, check })` as a property body to compare
named implementations on independently reconstructed inputs, with ordinary
property shrinking, witnesses, and corpora.

See the [package documentation](source/packages/differential/readme.md) for
installation, authoring, and outcome semantics.

## Linearizability checking

Install `@overkill-dev/linearizability` to check recorded concurrent histories
against a pure sequential model. `checkLinearizability(...)` supports pending
operations, an explicit work budget, and cancellation. Budget exhaustion returns
inconclusive rather than a consistency verdict.

See the [package documentation](source/packages/linearizability/readme.md) for
event logs, model transitions, and result semantics.
