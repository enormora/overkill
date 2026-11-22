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
Profiles in `overkill.config.ts` select each suite. Package smoke
tests import their outer authoring API through `#tests` so it resolves from the
repository dependencies while consumer checks use the freshly packed packages.
Leaf-package checks require exports from that packed consumer installation.
Imports for the code under test continue to target source modules. Engine
singletons are scoped to compatible execution protocols, so the checkout can
exercise its implementation alongside the published distribution.
Fixture programs under `source/integration-tests/integration/fixtures` provide
inputs to the source runner under test. Repository suite hosting and verification
come from the published package. Coverage integration checks execute source APIs
in a separate SUT process. CLI coverage checks exercise both execution modes through
the same source TypeScript entry point.
Tests of unmanaged engine execution use `runWithAttachmentContext(null, ...)`
to isolate it from the integration runner's attachment context.

## Repository checks

CI runs four categories of tests:

- Unit tests: `npx just test-unit-with-coverage`. This is the only unit run in CI.
  The source line reporter prints periodic progress in non-interactive logs,
  including GitHub Actions, and includes non-passing results and failure details.
  Overkill coverage includes production code under `source`, including `source/packages`,
  and excludes `*.entry-point.ts`, tests, fixtures, and test support. TypeScript
  files with no executable code are omitted from runtime coverage. The CLI configures V8 collection.
- Integration tests: `npx just test-integration`. Profiles under
  `source/integration-tests/<profile>/**/*.test.ts` cover real files, processes,
  compiler projects, and external execution boundaries. These tests
  do not contribute to unit coverage. The command also runs the
  `mutation-campaigns` profile with a separate budget for its subprocess matrix.
  `npx just test-process-integration` runs
  the process suite on Linux and macOS.
- Type tests: `npx just test-types`, for compile-time public API assertions.
- Package smoke tests: `npx just test-package-smoke`, for installed exports,
  declarations, CLI startup, and interoperability across package boundaries.
  These are integration tests in the `package-smoke` profile. The published
  runner executes them against packages freshly packed from this checkout.
  The Stryker smoke test runs one mutant against a one-line module; campaign
  matrices run in the `mutation-campaigns` profile.
  Publication dry runs execute as a separate CI job alongside package smoke tests.

Profiles discover TypeScript test sources directly through the published CLI.
Unit tests run in a supervised process with concurrent scheduling. Package
compilation is needed only for installed-package checks and publication.

Use `npx just test-unit` for a local unit run without coverage. Keep integration
tests under their profile directory so the unit glob excludes them.
Tests of property, benchmark, and mutation support are ordinary unit or
integration tests of those features. `npx just benchmark-mutation-cost` runs the
benchmark profile through the published CLI. CI does not run a mutation-score or
performance-regression gate for the repository.

Use tables for case matrices, macros for reusable node factories, and custom
assertions for shared domain checks. Test doubles and transcripts come from
`@overkill-dev/test`; keep source imports when those APIs are the subject of a
test. Integration fixtures can bind resources through
`@overkill-dev/test/resources`. Microtests keep setup in memory and use scope
methods for async checkpoints and cleanup of live resources. Memory-only fixtures
need no disposal unless disposal itself is under test. Let test callback scope
types infer where assertion narrowing permits it. Suite and child names should
read together without repeating their subject.

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
