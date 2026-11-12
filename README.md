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

## ESLint rule testing

Install `@overkill-dev/eslint-rule-test` to share rule definitions and named
configuration matrices between example suites and automated source/option
properties. See the [package documentation](source/packages/eslint-rule-test/readme.md).

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
