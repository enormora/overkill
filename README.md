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

Repository tests run through the published `@overkill-dev/run` package. The
`#test-runner` package import resolves it from this repository's dependencies,
including for package smoke tests with their own installed packages. Test files
continue to import source modules for the code under test.

## Repository checks

CI runs four categories of tests:

- Unit tests: `npx just test-unit-with-coverage`. This is the only unit run in CI.
  Coverage includes production code under `source`, including `source/packages`,
  and excludes `*.entry-point.ts`, tests, fixtures, and test support. TypeScript
  files with no executable code are omitted from runtime coverage.
- Integration tests: `npx just test-integration`. The suite in
  `source/integration-tests/repository.test.ts` owns tests that use real files,
  processes, compiler projects, or external execution boundaries. These tests
  do not contribute to unit coverage. CI divides this suite into eight shards;
  use `npx just test-integration 1/8` to reproduce one shard locally.
  `npx just test-process-integration` runs
  the process suite on Linux and macOS.
- Type tests: `npx just test-types`, for compile-time public API assertions.
- Package smoke tests: `npx just test-package-smoke`, for installed exports,
  declarations, CLI startup, and interoperability across package boundaries.
  The Stryker smoke test runs one mutant against a one-line module; campaign
  matrices belong in integration tests.
  Publication dry runs execute as a separate CI job alongside package smoke tests.

Use `npx just test-unit` for a local unit run without coverage. Keep integration
test nodes out of the unit aggregation rooted at `source/overkill.test.ts`.
Tests of property, benchmark, and mutation support are ordinary unit or
integration tests of those features. CI does not run a mutation-score or
performance-regression gate for the repository.

Compilation and static analysis are separate checks. Unit and integration tests
share one TypeScript compilation project. CI deliberately starts ESLint without
a restored cache and reports its most expensive rules. ESLint runs in eight
shards; use `npx just eslint-shard 1/8` to reproduce one shard locally. Every
configured, tracked file belongs to exactly one shard.

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
