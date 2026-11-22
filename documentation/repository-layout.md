# Repository layout

Shared feature folders under `source` contain the implementation. Entry points
under `source/packages` define the published packages assembled by Packtory.
Register dynamically loaded runner modules as private roots in `packtory.config.js`.

All generated assets, package builds, installed smoke consumers, coverage, and
runner state belong under `target`. Test recipes execute TypeScript sources
directly. Package compilation is needed for package consumers and publication.

## Repository tests

Install dependencies with `npm ci`. The published `@overkill-dev/test` package
provides test authoring, assertions, doubles, resources, and the `overkill` CLI.
Source imports identify the system under test, including fixture programs that
exercise the source runner. A change to source behavior needs no npm release to
be tested. Runtime coverage checks exercise both microtest execution modes.
One source CLI check exercises coverage flag and report wiring, and one packed
CLI check exercises the installed supervised worker and reporter.

| Profile                       | Boundary                                                                 | Command                                 |
| ----------------------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| `microtests`                  | In-memory behavior, supervised execution                                 | `just test-microtests`                  |
| `runtime`                     | Programmatic runtime integration, files, compiler projects, and real I/O | `just test-integration`                 |
| `cli`                         | CLI execution and process ownership on Linux and macOS                   | `just test-cli-integration`             |
| `package-smoke`               | Freshly packed package exports, consumers, and executable startup        | `just test-package-smoke`               |
| `mutation-campaigns`          | Representative Stryker lifecycle and accuracy cases                      | Included in `just test-integration`     |
| `mutation-campaigns-extended` | Full accuracy matrix and mutation-cost evidence                          | `just test-mutation-campaigns-extended` |

Integration files live under `source/integration-tests/<profile>`. Fixtures are
excluded from profile discovery. Runtime and CLI files form work units in reusable
worker pools. Mutation cases use individual work units; engine singleton checks
use fresh workers. Pools run one case per worker, with capacity following Node's
available CPU parallelism. Microtests use the same CPU
limit for concurrent cases in one supervised process.

CI runs microtests once with native coverage using
`just test-microtests-with-coverage`. Coverage includes production TypeScript and
excludes tests, executable entry points, integration fixtures, and test support.
Type tests run separately with `just test-types`. Compilation, static analysis,
and ESLint are separate checks: `just compile`, `just lint`, and `just eslint`.

Prefer inferred types. Add annotations only when TypeScript or ESLint requires
them, including TypeScript's explicit annotation requirement for assertion
narrowing. Use tables for input matrices, macros for reusable test construction,
and custom assertions for shared domain checks. Do not pass a full test scope to
helpers. Pass precise fixture capabilities when needed. Tables carry input data;
separate tests cover distinct behaviors. Memory-only fixtures need no disposal
unless disposal itself is under test. Name suites and their children so they read together without repeating
the subject.

Package smoke packs the current build once with Packtory. Per-case resources
create consumers under `target/package-smoke`. Runtime resolution and compiler
checks reject dependencies found in ancestor installations. Empty export maps also
block fallback when supervised children clear their Node options. Smoke children
retain system executable paths while excluding ancestor dependency bins. Add
environment inputs explicitly when a consumer needs them.

## Mutation validation

The standard integration gate compares representative real Stryker runs across
both process models, checks fresh-state cleanup, and reproduces the reused-state
cache limitation. Use `just test-mutation-campaigns-extended` for the full
coverage, process-model, freshness, seed, and repetition matrix and for
mutation-cost evidence. Package smoke loads the packed adapter to run one
mutant against a one-line module.

`just benchmark-mutation-cost` records source execution and campaign measurements
in `target/mutation-cost/report.html`. Measurements include Stryker reload and
worker replacement behavior; timings remain diagnostic. CI does not enforce a
mutation-score or performance-regression gate for this repository.

Shared fixtures in `source/test-support` use the test-support lint preset,
which permits fixture casts and literal sample data. Child fixtures with exact
output assertions retain permission auditing and disable Node's `PERM0004`
startup warning.
