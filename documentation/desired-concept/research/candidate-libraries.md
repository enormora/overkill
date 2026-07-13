# Candidate Libraries

## Purpose

This document collects libraries that may let Overkill reuse solid building blocks instead of rebuilding everything from scratch.

The goal is not to commit early. The goal is to keep a shortlist of plausible dependencies and clearly separate:

- strong implementation candidates
- useful idea donors
- options to reject as foundations

This document is intentionally broader than the current codebase. It looks in all directions that matter for Overkill:

- assertions
- deep comparison and diffs
- doubles and spying
- property-based testing
- coverage
- worker pools and scheduling
- subprocess and PTY execution
- snapshots and baseline infrastructure
- reporters and report artifact formats
- terminal rendering
- ESLint rule-test adapters and plugin utilities
- stack traces and source maps

Node built-ins should be preferred wherever they are good enough. Third-party packages should only win when they provide a clear capability gap.

## Audit Scope

This document was re-audited on 2026-05-13.

The audit used current npm metadata where available, especially:

- current published version
- last modified timestamp
- package typing metadata
- package repository

Important policy change:

- Overkill should strongly prefer libraries written in TypeScript
- if a library is JavaScript-first, it should usually be demoted to “idea donor” or rejected as a foundation, even if it is well-maintained

## Evaluation Rules

Prefer:

- TypeScript source first
- ESM support
- small and explicit APIs
- reusable infrastructure rather than framework-shaped assumptions
- dependencies that can sit behind Overkill-owned abstractions

Be careful with libraries that:

- assume Jest or Chai semantics everywhere
- require global state
- tightly couple assertions, snapshots, mocks, and runner behavior
- are JavaScript-only and hard to extend safely from TypeScript

Status labels used below:

- strong candidate
- secondary candidate
- idea donor
- reject for foundation use

## Current Repository Note

The current repository uses:

- `kleur`
- `figures`

Re-audit result:

- `kleur` should no longer be treated as the preferred terminal-color choice
- `figures` is acceptable, but not special enough to anchor a long-term direction

## Assertions

### `tcompare`

What it is:

- the comparison and diagnostic engine from the TAP ecosystem

Pros:

- current
- much more test-specific than generic equality libraries
- part of a relevant ecosystem for Overkill

Cons:

- still needs evaluation for how opinionated its comparison and output semantics are

Freshness note:

- `9.3.2`, last modified 2026-05-01

Assessment:

- strong candidate to evaluate

Source:

- <https://www.npmjs.com/package/tcompare>

### `earljs`

What it is:

- a TypeScript assertion library positioned as a modern Chai/Jest-space alternative

Pros:

- TypeScript-oriented
- matcher-style API
- includes snapshots, mocks, and plugins
- closer to Overkill than classic Chai

Cons:

- fairly broad framework surface
- snapshots and mocks are bundled into the same ecosystem
- current npm package looks quiet

Freshness note:

- `0.2.3`, last modified 2023-03-27

Assessment:

- idea donor and secondary candidate
- worth studying closely, but probably not the direct foundation for the
  built-in assertion surface in `@overkill/engine`

Source:

- <https://www.npmjs.com/package/earljs>

### `chai`

Pros:

- maintained
- widely understood
- framework-agnostic

Cons:

- JavaScript-first
- very broad style surface
- not aligned with Overkill’s TypeScript-first bar

Freshness note:

- `6.2.2`, last modified 2026-01-13

Assessment:

- idea donor only
- reject for foundation use

Source:

- <https://github.com/chaijs/chai>

### `unexpected`

Pros:

- strong output and plugin model

Cons:

- JavaScript-first
- larger conceptual surface than Overkill likely wants

Freshness note:

- `13.2.1`, last modified 2024-03-04

Assessment:

- idea donor only
- reject for foundation use

Source:

- <https://github.com/unexpectedjs/unexpected>

### Assertion Recommendation

Recommended direction:

- keep the public assertion surface in `@overkill/engine`
- use `@overkill/assert` for reusable assertion-extension helpers and
  adapter-building utilities
- treat low-level normalization and diff protocol as internal
- borrow ideas from `tcompare`, `earljs`, `chai`, and `unexpected`
- do not adopt a whole third-party assertion framework as the foundation

## Doubles And Spying

### Node `node:test` mock API

What it is:

- the built-in Node mocking surface exposed through the test runner

Pros:

- no dependency
- current
- useful as a design reference for call tracking and timer mocking

Cons:

- tightly tied to `node:test`
- leans toward method spying and replacement
- not a clean foundation for an explicit-injection-first doubles package

Assessment:

- idea donor

Source:

- <https://nodejs.org/api/test.html>

### `testdouble`

What it is:

- a library built around test double functions and `when(...).then...` style configuration

Pros:

- explicit test-double-first vocabulary
- `when()` style is relevant to Overkill's possible API direction
- useful example of function-double-centric design

Cons:

- current library still includes replacement APIs that patch module loading
- TypeScript support exists, but the implementation is not a TypeScript-first foundation
- package freshness looks weaker than top current candidates

Freshness note:

- `3.20.2`, npm metadata suggests the package has been relatively quiet

Assessment:

- idea donor
- especially useful for API-shape study, not as the base implementation

Source:

- <https://testdouble.github.io/testdouble.js/>

### `tinyspy`

What it is:

- a small spy library used in the Vitest ecosystem

Pros:

- small surface
- TypeScript typings included
- focused on call tracking rather than giant framework scope

Cons:

- limited compared with the full programmable-double concept Overkill wants
- better fit as a tiny spy layer than as the basis for one unified `testDouble()` abstraction

Freshness note:

- current enough to evaluate, but still needs direct repository review before adoption

Assessment:

- secondary candidate
- worth studying for implementation simplicity

Source:

- <https://www.npmjs.com/package/tinyspy>

### Doubles Recommendation

Recommended direction:

- build `@overkill/doubles`
- study `testdouble` for `when()`-style ergonomics
- study Node built-ins for call-tracking primitives
- optionally study `tinyspy` for minimal implementation shape
- do not adopt a patch-first doubles library as the direct foundation

## Property-Based Testing

### `fast-check`

What it is:

- the dominant current JavaScript property-based testing library

Pros:

- current
- TypeScript typings included
- broad generator surface
- still the most obvious JS idea donor and experimental backend candidate

Cons:

- its long-term model does not line up exactly with Overkill's desired
  direction around integrated shrinking guarantees, persistent corpora,
  and the fuller model/state-machine story

Freshness note:

- `4.8.0`, last modified 2026-05-11

Assessment:

- strong idea donor
- possible short-term experimentation backend
- not the conceptual target to build around blindly

Source:

- <https://github.com/dubzzz/fast-check>

### `pure-rand`

What it is:

- the small PRNG package from the `fast-check` ecosystem

Pros:

- current
- focused
- directly relevant to Overkill's splittable seeded-randomness needs

Cons:

- still needs direct evaluation for whether its generator model lines up
  cleanly with the exact split/derive semantics Overkill wants

Freshness note:

- `8.4.0`, last modified 2026-03-27

Assessment:

- strong candidate to evaluate

Source:

- <https://github.com/dubzzz/pure-rand>

### `gentest`

What it is:

- a smaller generator/property library that is especially useful as a
  design reference for keeping the generator algebra compact

Pros:

- strong reminder to keep the primitive generator surface small and
  compositional
- useful reference for `map` / `flatMap` / tuple / object-shape style
  composition and explicit sampling

Cons:

- not a TypeScript-first modern foundation candidate for Overkill
- more useful as a philosophy and API-shape donor than as an adopted
  implementation dependency

Assessment:

- idea donor

Source:

- <https://github.com/graue/gentest>

### Property Recommendation

Recommended direction:

- keep `fast-check` as the main JS reference point and experimental
  comparison baseline
- evaluate `pure-rand` for the seeded/splittable randomness layer
- treat `gentest` as an API-shape donor for keeping generator primitives
  small and compositional
- do not commit the future `@overkill/property` package to `fast-check`'s
  current model if it conflicts with integrated shrinking, edge-case
  semantics, exhaustive finite domains, or witness/corpus workflows

## Coverage

### `c8`

What it is:

- the familiar Node/V8 coverage CLI used by many projects

Pros:

- well-known
- straightforward
- integrates with native V8 coverage

Cons:

- maintenance concerns are real enough that Overkill should not treat it as the only recommended story
- does not by itself solve the broader policy and permission questions

Freshness note:

- npm metadata still shows an actively published package, but it no longer feels like the only serious direction

Assessment:

- compatibility path
- not the only recommended future-facing option

Source:

- <https://www.npmjs.com/package/c8>

### `monocart-coverage-reports`

What it is:

- a coverage tool focused on native V8 reports and Istanbul-compatible reports

Pros:

- explicitly V8-focused
- supports multiple report styles
- looks like a serious modern candidate for Node-first coverage workflows

Cons:

- still needs direct hands-on evaluation in the Overkill context
- broader than a minimal runner integration

Freshness note:

- current package line appears active in recent npm metadata

Assessment:

- strong candidate to evaluate

Source:

- <https://github.com/cenfun/monocart-coverage-reports>

### Vitest V8 Coverage Approach

What it is:

- not a standalone library recommendation by itself, but a relevant modern reference for V8 coverage remapping quality

Pros:

- current documentation explicitly describes more accurate V8 coverage remapping
- useful as an idea donor even if Overkill does not reuse Vitest internals directly

Cons:

- tied to another runner ecosystem

Assessment:

- idea donor
- important reference point for what “modern V8 coverage” should look like

Source:

- <https://main.vitest.dev/guide/coverage>

### Coverage Recommendation

Recommended direction:

- keep coverage off by default
- make it easy to enable through explicit orchestration
- support `c8` as a compatibility path
- seriously evaluate newer V8-native reporting tools such as `monocart-coverage-reports`
- treat Vitest’s current V8 remapping work as an important quality reference

## Deep Comparison, Formatting, And Diffs

### Node `util.isDeepStrictEqual`

Pros:

- no dependency
- strong correctness baseline

Cons:

- limited customization
- not a formatting or diff solution

Assessment:

- strong baseline option

Source:

- <https://nodejs.org/api/util.html>

### `fast-equals`

Pros:

- TypeScript-written
- configurable equality surface
- current

Cons:

- equality only

Freshness note:

- `6.0.0`, last modified 2025-12-19

Assessment:

- strong candidate
- best current third-party deep-equality candidate in this document

Source:

- <https://github.com/planttheidea/fast-equals>

### `dequal`

Pros:

- tiny
- simple API

Cons:

- old
- built-in typings do not make it TypeScript-first
- equality only

Freshness note:

- `2.0.3`, last modified 2022-07-11

Assessment:

- idea donor or fallback only
- reject as the preferred foundation

Source:

- <https://www.npmjs.com/package/dequal>

### `pretty-format`

Pros:

- current
- very relevant to snapshots and assertion output
- plugin model

Cons:

- tied to the Jest ecosystem

Freshness note:

- `30.3.0`, last modified 2026-03-10

Assessment:

- strong candidate

Source:

- <https://github.com/jestjs/jest/tree/main/packages/pretty-format>

### `jest-diff`

Pros:

- current
- directly relevant to assertion and snapshot diffs
- better current recommendation than the old `jsdiff` suggestion

Cons:

- tied to the Jest ecosystem

Freshness note:

- `30.3.0`, last modified 2026-03-10

Assessment:

- strong candidate

Source:

- <https://www.npmjs.com/package/jest-diff>

### `diff` from the `jsdiff` repository

Pros:

- mature
- still maintained

Cons:

- not TypeScript-first
- text diff only

Freshness note:

- `9.0.0`, last modified 2026-04-13

Assessment:

- secondary candidate
- prefer `jest-diff`

Source:

- <https://github.com/kpdecker/jsdiff>

### Comparison And Diff Recommendation

Recommended direction:

- equality:
  - Node `util.isDeepStrictEqual`
  - `fast-equals`
  - `tcompare` as a test-specific comparison candidate
- serialization:
  - `pretty-format`
- diffs:
  - `jest-diff`

## Worker Pools And Scheduling

### `tinypool`

Pros:

- TypeScript
- small
- supports `worker_threads` and `child_process`
- current

Cons:

- intentionally minimal

Freshness note:

- `2.1.0`, last modified 2026-01-03

Assessment:

- strong candidate

Source:

- <https://github.com/tinylibs/tinypool>

### `piscina`

Pros:

- TypeScript
- mature
- richer pool controls

Cons:

- larger conceptual surface than `tinypool`

Freshness note:

- `5.1.4`, last modified 2025-11-07

Assessment:

- strong candidate
- richer fallback if `tinypool` proves too minimal

Source:

- <https://github.com/piscinajs/piscina>

### Worker Pool Recommendation

Recommended direction:

- prototype against `tinypool`
- keep `piscina` as the upgrade path

## Subprocesses And PTYs

### `foreground-child`

Pros:

- current
- directly relevant to crash-only supervision and sidecar ideas
- part of the TAP ecosystem

Cons:

- more specialized than ordinary subprocess execution
- should not become the default path for cheap in-process microtests

Freshness note:

- `4.0.3`, last modified 2026-02-06

Assessment:

- strong candidate for supervised or disposable execution profiles

Source:

- <https://www.npmjs.com/package/foreground-child>

### `tinyexec`

Pros:

- current
- typed
- much smaller conceptual surface than `execa`
- good fit for Overkill’s explicit style

Cons:

- less feature-rich than `execa`

Freshness note:

- `1.1.2`, last modified 2026-04-29

Assessment:

- strong candidate

Source:

- <https://www.npmjs.com/package/tinyexec>

### `execa`

Pros:

- maintained
- powerful
- excellent ergonomics

Cons:

- richer and more opinionated than Overkill may need
- not the first minimal TypeScript-native recommendation

Freshness note:

- `9.6.1`, last modified 2025-11-29

Assessment:

- secondary candidate
- strong fallback if Overkill wants a richer subprocess layer

Source:

- <https://github.com/sindresorhus/execa>

### `nano-spawn`

Pros:

- current
- small
- attractive low-magic process API

Cons:

- less proven than `execa`
- needs closer evaluation before promotion to default choice

Freshness note:

- `2.1.0`, last modified 2026-04-01

Assessment:

- secondary candidate

Source:

- <https://www.npmjs.com/package/nano-spawn>

### `node-pty`

Pros:

- current
- essential for real PTY behavior
- necessary for realistic CLI benchmarking and terminal snapshots

Cons:

- native dependency
- more operational complexity than plain subprocesses

Freshness note:

- `1.1.0`, last modified 2026-04-23

Assessment:

- strong candidate
- keep package-local to features that truly need PTYs

Source:

- <https://github.com/microsoft/node-pty>

### Process Recommendation

Recommended direction:

- prefer `tinyexec` first
- evaluate `nano-spawn`
- keep `execa` as the richer fallback
- evaluate `foreground-child` specifically for supervised or crash-only profiles
- use `node-pty` only where terminal semantics are required

## Snapshots And Baselines

### `@tapjs/snapshot`

Pros:

- current
- part of the TAP ecosystem
- much more relevant than older JS-only snapshot utilities

Cons:

- still needs evaluation for TAP-specific assumptions

Freshness note:

- `4.3.8`, last modified 2026-05-01

Assessment:

- strong candidate to evaluate

Source:

- <https://www.npmjs.com/package/@tapjs/snapshot>

### `concordance`

Pros:

- relevant prior art

Cons:

- not TypeScript-first
- tied to older AVA design space

Assessment:

- idea donor only

Source:

- <https://github.com/avajs/concordance>

### `jest-snapshot`

Pros:

- current
- mature behavior

Cons:

- heavy Jest ecosystem coupling

Freshness note:

- `30.3.0`, last modified 2026-03-10

Assessment:

- idea donor and secondary candidate
- useful to study, but not the obvious foundation

Source:

- <https://www.npmjs.com/package/jest-snapshot>

### `@vitest/snapshot`

Pros:

- current
- TS-era ecosystem fit
- closer to Overkill’s preferences than older JS-only snapshot utilities

Cons:

- still shaped by the Vitest ecosystem

Freshness note:

- `4.1.5`, last modified 2026-04-23

Assessment:

- strong candidate to evaluate

Source:

- <https://www.npmjs.com/package/@vitest/snapshot>

### Snapshot Recommendation

Recommended direction:

- evaluate `@tapjs/snapshot`
- evaluate `@vitest/snapshot`
- otherwise build `@overkill/baselines` on top of:
  - `pretty-format`
  - `jest-diff`
  - Overkill-owned identity, update, and stale-detection logic

## ESLint Tooling

### `@eslint-community/eslint-utils`

What it is:

- utility helpers for building ESLint rules and rule-analysis logic

Pros:

- current
- explicit TypeScript typings
- directly relevant to `@overkill/eslint-plugin` utility work such as
  scope-aware binding analysis

Cons:

- does not solve Overkill's full binding-tracing problem by itself
- should be treated as a helper layer, not as the design source of truth

Freshness note:

- `4.9.1`, last modified 2026-01-11

Assessment:

- strong candidate to evaluate

Source:

- <https://github.com/eslint-community/eslint-utils>

### `@typescript-eslint/rule-tester`

What it is:

- the stricter TypeScript-era wrapper around ESLint rule-testing patterns

Pros:

- current
- directly relevant to the future `@overkill/eslint-rule-test` adapter
- useful reference for typed/parser-heavy rule-test cases

Cons:

- still shaped around the ESLint `RuleTester` world rather than Overkill's
  own suite/macro model
- better as a compatibility and case-shape reference than as the final
  Overkill API

Freshness note:

- `8.59.3`, last modified 2026-05-11

Assessment:

- strong idea donor
- likely compatibility reference

Source:

- <https://github.com/typescript-eslint/typescript-eslint/tree/main/packages/rule-tester>

### ESLint Recommendation

Recommended direction:

- evaluate `@eslint-community/eslint-utils` for the future
  `@overkill/eslint-plugin`
- study `@typescript-eslint/rule-tester` as the strongest current
  compatibility reference for `@overkill/eslint-rule-test`
- keep Overkill's public rule-test authoring surface macro/suite-based
  rather than exposing raw `RuleTester` as the first-class primitive

## HTML, XML, And Machine-Readable Reporting

### JUnit XML

Assessment:

- strong output target
- not an internal model

Reason:

- broad CI interoperability

### `allure3`

Pros:

- TypeScript-based
- modular
- rich report UI

Cons:

- large conceptual surface
- easy to let it become the product instead of an output target

Assessment:

- strong integration target
- weak foundation for Overkill’s own report model

Source:

- <https://github.com/allure-framework/allure3>

### Reporting Recommendation

Recommended direction:

- first ship JSON/event-stream, JUnit XML, line, TAP
- treat HTML as a higher-level artifact built on those
- support Allure as an integration target, not the center of the design

## Terminal Output

### `chalk`

Pros:

- current
- widely used
- maintained

Cons:

- broader and heavier-feeling than the tiniest alternatives
- not clearly a better fit than smaller current options if Overkill wants to stay minimal

Freshness note:

- `5.6.2`, last modified 2025-10-29

Assessment:

- secondary candidate

Source:

- <https://github.com/chalk/chalk>

### `ansis`

Pros:

- current
- tiny
- strong replacement candidate for `kleur`

Cons:

- package metadata alone does not prove TypeScript authorship as clearly as some other candidates

Freshness note:

- `4.2.0`, last modified 2026-03-27

Assessment:

- strong candidate to evaluate

Source:

- <https://www.npmjs.com/package/ansis>

### `yoctocolors`

Pros:

- current
- tiny
- better current recommendation than `kleur`

Cons:

- package metadata alone does not prove TypeScript authorship as clearly as some other candidates

Freshness note:

- `2.1.2`, last modified 2025-08-19

Assessment:

- strong candidate to evaluate

Source:

- <https://www.npmjs.com/package/yoctocolors>

### `kleur`

Freshness note:

- `4.1.5`, last modified 2023-07-09

Assessment:

- reject as the preferred modern choice

Source:

- <https://github.com/lukeed/kleur>

### `figures`

Freshness note:

- `6.1.0`, last modified 2024-03-04

Assessment:

- acceptable but not especially compelling

Source:

- <https://www.npmjs.com/package/figures>

### `log-symbols`

Pros:

- current
- simple
- good match for reporter-local status symbols

Cons:

- narrower than `figures`

Freshness note:

- `7.0.1`, last modified 2025-10-13

Assessment:

- strong candidate to evaluate

Source:

- <https://www.npmjs.com/package/log-symbols>

### Terminal Recommendation

Recommended direction:

- stop treating `kleur` as the default answer
- evaluate `ansis` or `yoctocolors` for color output
- evaluate `log-symbols` for simple status symbols
- keep terminal rendering logic in reporter packages, not in `@overkill/engine`

## Stack Traces And Source Maps

## Node Built-Ins First

### Built-in TypeScript execution and type stripping

Current Node has stable built-in type stripping and can execute `.ts` files directly when the syntax is erasable.

Why it matters:

- strongly aligns with Overkill’s desire to run TypeScript directly
- reduces the need for third-party loaders

Important caveat:

- Node intentionally ignores `tsconfig.json`
- non-erasable TypeScript syntax still needs `--experimental-transform-types` or a third-party tool

Assessment:

- preferred default path for simple direct execution

Sources:

- <https://nodejs.org/api/typescript.html>
- <https://nodejs.org/en/learn/typescript/run-natively>

### Built-in watch mode

Node has built-in `--watch` mode.

Assessment:

- preferred first path to evaluate before adding watcher dependencies

Source:

- <https://nodejs.org/dist/latest/docs/api/cli.html>

### Built-in globbing and path glob matching

Current Node provides:

- `fs.glob()` / `fs/promises.glob()`
- `path.matchesGlob()`

Assessment:

- prefer Node built-ins first
- only reach for `glob` if Node’s built-ins prove insufficient

Sources:

- <https://nodejs.org/download/release/latest-jod/docs/api/fs.html>
- <https://nodejs.org/api/path.html>

### `glob`

Pros:

- current
- mature
- explicit fallback if Node built-ins prove insufficient

Cons:

- unnecessary if Node’s built-in glob support is enough
- should not be the first choice anymore

Freshness note:

- `13.0.6`, last modified 2026-02-19

Assessment:

- secondary candidate

Source:

- <https://www.npmjs.com/package/glob>

### Node built-ins

Assessment:

- preferred path

Reason:

- no dependency and matches the modern Node-first direction

### `source-map-support`

Freshness note:

- `0.5.21`, last modified 2023-06-09

Assessment:

- fallback only
- reject as a preferred foundation

Source:

- <https://github.com/evanw/node-source-map-support>

## Shortlist

If Overkill had to choose a strict shortlist today, it would be:

- assertions:
  - evaluate `tcompare`
  - study `earljs`
- equality:
  - `fast-equals`
  - Node `util.isDeepStrictEqual`
- serialization and diffs:
  - `pretty-format`
  - `jest-diff`
- property testing:
  - `pure-rand`
  - `fast-check` as the main JS comparison point
  - `gentest` as an API-shape donor
- worker pools:
  - `tinypool`
  - `piscina`
- subprocesses and PTYs:
  - `tinyexec`
  - `nano-spawn`
  - `execa` as richer fallback
  - `foreground-child` for supervised profiles
  - `node-pty`
- snapshots:
  - `@tapjs/snapshot`
  - `@vitest/snapshot`
  - otherwise build on lower-level pieces
- ESLint tooling:
  - `@eslint-community/eslint-utils`
  - `@typescript-eslint/rule-tester`
- terminal:
  - `ansis`
  - `yoctocolors`
  - `log-symbols`
  - `chalk` as the broader maintained fallback
- source maps:
  - Node built-ins first
- execution and discovery:
- Node built-in type stripping first
- Node `--watch` first
- Node built-in globbing first

## Libraries To Treat Mainly As Idea Donors Or Reject As Foundations

- `chai`
- `unexpected`
- `concordance`
- `dequal`
- `kleur`
- `source-map-support`

These may still be useful to study, but they should not be the default foundations for Overkill under the current TypeScript-first and low-magic concept.
