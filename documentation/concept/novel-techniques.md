# Novel And Under-Used Testing Techniques

## Position

This document covers **exploratory, research-flavored techniques** —
things where the underlying mechanism, ergonomics, or integration with
Overkill still need investigation before they can be committed to.

Most JS test runners normalize a small subset of techniques: example
tests, sometimes snapshots, sometimes a thin property-test layer. The
wider testing literature has many more shapes that are well established
in other ecosystems and largely missing from JS/TS. This doc surveys
them and identifies the kernels Overkill should preserve as future
package families or first-class test kinds.

The goal is not to ship all of these. It is to ensure the architecture
stays _open_ to them, with the engine, identity, baseline, and reporter
contracts strong enough that adding any one is a matter of writing a
package.

For well-understood enhancements where the shape is already clear (such
as contract testing, golden/approval workflows, builder-style test data
factories), see `ideas-and-future-directions.md`. Companion docs:
`research-landscape.md` (prior art), `deterministic-simulation.md`, and
`capability-handles.md`.

> **Note on code samples.** The snippets below use illustrative
> primitives such as `forall`, `gen.user`, `arbitrary.bytes`,
> `relation()`, `differential()`, `hyperproperty()`, `slo()`, `fuzz()`,
> and `baseline()`. These are _proposed future-package syntax_, not
> committed APIs. They are listed as placeholders in
> `types-index.md` § Placeholders Without Domain Definitions.

## Property-Based Testing — What It Should Mean Specifically

Overkill should treat property-based testing as more than "random inputs +
shrink." Concrete commitments worth making explicit:

-   **Integrated shrinking** — generators yield rose trees `{ value, shrinks: () => Iterable<Tree<T>> }`, not separate `shrink` functions.
    Hedgehog-style. Avoids fast-check's invariant-breaking shrinking
    pitfalls.
-   **Splittable PRNGs** — see `capability-handles.md`. Each generator
    splits a child PRNG; parallel and tree-shaped generation stays
    reproducible. SplitMix is the canonical algorithm.
-   **Coverage / Classify / Label** — generators report distribution; a
    property fails not only on a counterexample but also when its input
    distribution drifts (`cover 30 isSorted`).
-   **Witness-replay artifacts** — `*.witness.json` per failing
    property; reruns load the witness and reproduce bit-for-bit. See
    `failure-artifacts.md` § Witnesses And Replay Artifacts for the
    schema.
-   **Persistent regression corpus** — every failing example is added to a
    per-test corpus replayed eagerly on the next run. Hypothesis (Python)
    and AFL-style fuzzers do this; JS PBT tools mostly do not.
-   **Targeted PBT** — search the input space with a user-supplied
    distance function as feedback (PropEr's targeted mode). Better than
    blind random for properties with tight invariants.
-   **Stateful / model-based** — programs are sequences of commands; the
    SUT is run in lockstep with a pure model; postconditions check
    observational equivalence. `quickcheck-state-machine` and
    `quickcheck-dynamic` (used by Cardano for finance-grade systems) are
    the references.
-   **Parallel / linearisability** — the same model executed
    concurrently; the checker validates that the observed history is
    linearisable. Combine with Porcupine-style checking.

Likely package home: `@overkill/property` plus `@overkill/model` for the
state-machine and parallel layers.

Relationship to existing JS tools:

-   `fast-check` is the most obvious current JS reference point and should be
    treated as a serious idea donor
-   it may still be useful for experimentation, adapter layers, or partial
    reuse of generator ergonomics
-   it is not the exact conceptual target for Overkill's long-term property
    layer, because the desired direction here includes stronger integrated
    shrinking guarantees, witness/corpus workflows, and a more explicit
    model/state-machine story

So the stance should be: learn from `fast-check`, borrow where it genuinely
fits, but do not constrain the future property package to fast-check's
current model if the architecture wants a stricter or richer design.

## Metamorphic Testing

When you cannot write `expect(f(x)).toBe(K)` because there is no oracle, you
can usually write `expect(f(x)).equiv(g(f(transform(x))))`. Examples:

-   `sort(shuffle(xs)) === sort(xs)`
-   `serialize(deserialize(s)) === s`
-   `compile(rename(p)) === rename(compile(p))`
-   `parse(format(x)) === x`

This is "test the relation, not the example." It is well established for
compilers, ML models, and scientific code; it is rare in JS. Overkill should
ship `relation()` as a first-class primitive:

```ts
test('round trip', ({ relation, gen }) =>
    relation('parse∘serialize = id', gen.user, (u) => deepEqual(parse(serialize(u)), u)));
```

The relation, the transformation, and the input distribution are all
recorded. Shrinking is automatic via the underlying PBT layer.

## Coverage-Guided In-Process Fuzzing

`jazzer.js` (Code Intelligence) is a libFuzzer binding for Node with both
Jest integration and standalone use. Coverage-guided fuzzing is a property
test where the runner watches code coverage and steers inputs toward new
edges. Most JS PBT tools do not do this.

Overkill direction:

-   reuse the same coverage instrumentation already needed for coverage
    reporting as the feedback signal for fuzzing
-   tests look like `fuzz('parser', (data) => parse(data))`
-   persist the corpus to `.overkill/corpus/<test-id>/`
-   replay the corpus eagerly on every run as deterministic regression
-   crash and timeout reports are first-class failure artifacts

Likely package home: `@overkill/fuzz`. Defer until the coverage story is
stable.

## Mutation Testing 2.0

Stryker integration is already planned (`overview.md`). Beyond the basic
"mutate code, run all tests" loop:

-   **Incremental mutation testing** — only mutate touched lines since
    last green; share the test-to-mutant graph
-   **Extreme mutation testing** — replace whole function bodies; cheaper
    and surfaces "no test cares about this function at all" faster
-   **Mutating test code itself** — flips assertion operators in the test
    to detect "useless assertions"
-   **LLM-proposed mutants** — `LLMorpheus` and Meta's ACH show LLM
    mutators outperform fixed operator sets for catching real-world
    bugs
-   **Shared instrumentation with coverage** — one instrumentation pass,
    two products

Overkill keeps this above the engine but ensures the engine exposes the
selection / focus / reporting surfaces a mutation tester needs.

## Differential Testing

Run two implementations on the same input; assert outputs match. Examples:

-   native vs polyfill
-   optimized vs naive
-   parser-A vs parser-B
-   old version vs new version (regression)
-   typed vs untyped variant of the same algorithm

`differential(implA, implB, gen)` is a primitive. Composes with shrinking.
Especially useful when a project ships its own implementation of a standard
(JSON parser, regex engine, scheduler).

`quickcheck-state-machine`'s parallel mode is the gold standard.

## Hyperproperties / 2-Trace Properties

A property says "for all `x`, `P(f(x))`." A hyperproperty says "for all `x`,
`x'`, `R(f(x), f(x'))`." The canonical case is constant-time security:

```ts
hyperproperty('constant-time hmac', [secretGen, secretGen], (a, b) => {
    const ta = measureNs(() => hmac(a));
    const tb = measureNs(() => hmac(b));
    return Math.abs(ta - tb) < threshold;
});
```

`perf_hooks.Histogram` provides percentile-stable measurement. Niche but a
real differentiator, especially for crypto / auth code paths. No mainstream
JS test runner exposes hyperproperties.

## Linearizability And Consistency Model Checking

Concurrent JS code (workers, `Atomics`, `SharedArrayBuffer`) needs more than
example tests. Porcupine (Go) is the fastest open-source linearisability
checker; Knossos (Jepsen) is the original. Algorithm fits in a few hundred
lines; portable to TS.

Overkill direction: `@overkill/history` checker that, given a recorded
interaction log and a sequential model, decides linearisability. Pairs with
the stateful PBT layer. For users writing code with `Atomics.wait`, this is
the only correctness check that matters.

## Chaos Testing In Unit-Test Scope

Most chaos tooling targets integration scope (Toxiproxy, Chaos Mesh).
Application-level unit-scope chaos is a wide-open area: inject clock skew
via fake timers, dropped messages via virtual transport, OOM via allocator
hooks, partial writes via virtual fs. The arXiv survey _Chaos Engineering
in the Wild_ (2025) found application-level faults are only 3% of chaos
tooling.

Composes naturally with the deterministic simulation layer: a "chaos
profile" is a virtual world configured with a fault distribution. Code that
explicitly handles failure (retries, circuit breakers, OOM defenses) gets a
real test runtime.

## Out-Of-Band Verdicts

Mainstream JS runners model verdicts as `pass | fail | skip`. JUnit5 / pytest
/ TestNG model far more:

-   `xfail` — expected to fail; passes when it _does_ fail; flips to a
    `xpass` regression if it unexpectedly passes
-   `inconclusive` — runtime unhealthy; not the test's verdict
-   `not-applicable` — precondition not met; distinct from skip
-   `flaky-detected` — passed only after retry
-   `quarantined` — known-flaky, allowed to fail without gating

TAP supports `# SKIP` and `# TODO` directives natively. Overkill should
expose first-class verdicts so CI consumers (and humans) distinguish "this
is broken" from "we couldn't tell" from "we expect this until #4123 lands."

The split between engine `TestOutcome` (`pass | fail | skip |
inconclusive`) and reporter-facing verdicts is settled (see `glossary.md`
§ Test Outcome / Test Verdict): engine outcomes stay narrow; richer
verdicts are derived by orchestration from `(outcome, metadata,
runner-error?)`. Adding a new verdict means adding a derivation rule, not
a new engine constructor.

## Test Impact Analysis (TIA)

Microsoft's TIA at scale; Wallaby's per-keystroke variant; Bazel's runfile
graph; Vitest's Vite-graph-based selective rerun. The kernel: maintain a
code→test bidirectional map; on commit, run only affected tests.

**Status: open research.** The current concept does not commit to
shipping a dependency graph. Path-level change detection (`--changed`
in `metadata-and-selection.md`) is the baseline; `--watch` reuses
Node's built-in watcher. True TIA would require:

-   per-test reverse-import tracking (e.g. via `module.registerHooks`)
-   a persisted, content-hash-keyed graph
-   invalidation on source change

If pursued later, the user-facing commitments would be:

-   `overkill --since <ref>` runs only tests affected by changes since
    `<ref>`
-   `overkill --watch` runs only affected tests on each save
-   the dependency graph is a public artifact for CI to query

This is one of the highest-leverage potential user-facing wins, but
not part of the settled concept.

## SLO / Latency-Sensitive Testing

Bake p99 budgets into tests, not just into benchmarks. `perf_hooks.Histogram`
gives percentile-stable measurement.

```ts
test('parse is fast', ({ slo }) => slo({ p99: '5ms', samples: 1000 }, () => parseLargeJson(fixture)));
```

Different from benchmarks (which are workload-shaped, calibrated, and
budgeted at suite level). Same metric, two consumers. `@overkill/bench`
already has the measurement plumbing; SLO tests reuse it without paying
benchmark setup costs.

## AI-Augmented Testing

The 2026 state of the art: LLMs are mediocre at writing oracle-bearing
tests (they invent assertions that pass) but very good at:

-   proposing property generators and metamorphic relations
-   proposing mutants for mutation testing
-   describing failing-test root causes from witnesses

Overkill's posture should not be "generate tests for me." It should be
"expose the structured artifacts (witnesses, traces, mutants, coverage
gaps) that make AI-assisted analysis productive." That is already the
direction the engine is heading; making MCP integration a first-class
extension surface ensures editor-driven AI tooling can plug in.

## Time-Travel Debugging

`replay.io` (browser), `rr` (Linux), Wallaby's in-editor time-travel debugger.
A test runner that captures every test as a re-playable trace catches
heisenbugs that only appear once.

For Overkill: don't compete with `replay.io` on browser recording. _Do_
guarantee that any failing test in the deterministic-simulation profile is
reproducible from the recorded seed alone. The witness format from
`deterministic-simulation.md` is already the trace; an external viewer can
play it back.

## Tools Worth Tracking

Pointers, not deep dives — for future audits:

-   `@playwright/test` — sharding model and trace viewer worth borrowing
-   `Effection v3` — structured concurrency, useful for the simulation
    scheduler
-   `effect-ts` — full effect system; idea donor for explicit
    capability/runtime design
-   `@hyperjump/json-schema-test` — schema-driven test runner
-   `@japa/runner` — interesting plugin model
-   `riteway` — five-question test design philosophy
-   `vest` — validation-as-test inversion
-   `oxlint` — Rust-based JS linter; check for test-specific rules
-   `msw` — consensus 2026 winner for HTTP request interception (note:
    works with Overkill capability handles by being passed in as the
    `http` handle implementation)
-   `axe-core` — accessibility testing as property
-   `Porcupine` — linearisability checker, port to TS
-   `Jazzer.js` — coverage-guided JS fuzzer
-   `Hedgehog` ports — integrated shrinking reference

These should be re-audited periodically alongside `candidate-libraries.md`.

## Recommended Path

If Overkill commits to incorporating these in priority order:

1.  **First-class verdict ADT** (out-of-band verdicts) — cheapest, highest
    ergonomic win, immediately distinguishes from Jest/Vitest
2.  **Splittable PRNG + integrated shrinking** — foundation for everything
    that follows, ~150 LoC of core
3.  **Witness-replay artifacts** — slot directly into existing baselines /
    failure-artifacts model
4.  **TIA with persistent dynamic call graph** — open research (see
    Test Impact Analysis section); the user-facing surface is sketched
    but not committed
5.  **Stage-1 deterministic simulation** (virtual clock + scheduler) —
    replaces 80% of fake-timer usage with deterministic equivalents
6.  **`relation()` primitive** — metamorphic testing as a first-class
    shape
7.  **Hyperproperties** — niche but unique
8.  **Differential testing** — small package, big win for projects with
    parallel implementations
9.  **Coverage-guided fuzzing** — defer until coverage is stable
10. **Linearisability checker** — defer until concurrent-JS users
    materialise
11. **Approval-test workflow** — defer; the well-understood shape lives in
    `ideas-and-future-directions.md` § Approval And Golden Workflow Testing

In-source tests are intentionally **not** in this list: the settled
concept rejects them as the default authoring model and the research
record lives in `non-goals.md` § Deferred With Research (see also
`microtests-and-capabilities.md` and `tests-as-values.md` § Recommendation).

Item 1 is essentially free given decisions already made. Items 2, 3, 5
are the big architectural commitments. Item 4 (TIA) is open research.
Items 6–11 are package-by-package extensions.

## Sources

-   [Hedgehog — Gens N' Roses (Jacob Stanley)](https://github.com/hedgehogqa/haskell-hedgehog/blob/master/doc/gens-n-roses.md)
-   [quickcheck-state-machine](https://github.com/stevana/quickcheck-state-machine)
-   [quickcheck-dynamic (Cardano / IOG)](https://github.com/input-output-hk/quickcheck-dynamic)
-   [PropEr — Targeted Property-Based Testing](https://proper-testing.github.io/papers/issta2017.pdf)
-   [LLMorpheus (GitHub Next)](https://github.com/githubnext/llmorpheus)
-   [Meta — LLM Mutation Testing (InfoQ Jan 2026)](https://www.infoq.com/news/2026/01/meta-llm-mutation-testing/)
-   [Jazzer.js](https://github.com/CodeIntelligenceTesting/jazzer.js)
-   [Porcupine — linearisability checker](https://github.com/anishathalye/porcupine)
-   [Knossos — Jepsen's linearisability checker](https://github.com/jepsen-io/knossos)
-   [Microwalk — JS side-channel testing (CANS 2024)](https://link.springer.com/chapter/10.1007/978-981-97-8016-7_2)
-   [ApprovalTests organisation](https://github.com/approvals)
-   [Chaos Engineering in the Wild (arXiv May 2025)](https://arxiv.org/html/2505.13654v1)
-   [TC39 `import defer`](https://github.com/tc39/proposal-defer-import-eval)
-   [Vitest in-source guide](https://vitest.dev/guide/in-source)
