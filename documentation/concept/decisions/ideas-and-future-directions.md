# Ideas And Future Directions

## Purpose

This document collects directions Overkill is open to but not yet
committed to. It has two parts:

-   **Future Directions With Known Shape** — well-understood enhancements
    where the shape of each is reasonably clear; what is missing is
    mostly time, prioritisation, or a triggering use case. Some of these
    may become first-class packages later. Others may stay as
    integrations or idea donors.
-   **Research-Stage Techniques** — exploratory, research-flavored
    techniques where the underlying mechanism, ergonomics, or
    integration with Overkill still need investigation before they can
    be committed to. The goal is not to ship all of these; it is to
    ensure the architecture stays _open_ to them.

> **Note on code samples.** Snippets in the research-stage section use
> illustrative primitives such as `forall`, `gen.user`, `arbitrary.bytes`,
> `relation()`, `differential()`, `hyperproperty()`, `slo()`, `fuzz()`,
> and `baseline()`. These are _proposed future-package syntax_, not
> committed APIs. They are listed as placeholders in
> [Types Index § Placeholders Without Domain Definitions](../reference/types-index.md#placeholders-without-domain-definitions).

Companion docs: [Research Landscape](../research/research-landscape.md)
(prior art), [Deterministic Simulation Testing](../authoring/deterministic-simulation.md),
and [Capability Handles](../authoring/capability-handles.md).

## Future Directions With Known Shape

### Contract Tests

#### What This Means

Contract tests verify that a system still conforms to an agreed external contract.

The contract may describe:

-   an HTTP API
-   a JSON payload shape
-   an OpenAPI or GraphQL schema
-   a CLI behavior contract
-   an event stream or message format
-   a producer/consumer agreement between services

This is different from ordinary unit tests:

-   unit tests ask "does this code behave as expected in this example?"
-   contract tests ask "does this system still honor the agreement that other code depends on?"

#### Why It Might Matter For Overkill

Contract tests fit Overkill surprisingly well because they often need:

-   stable artifact identity
-   reviewable baselines
-   structured diffs
-   runtime-aware execution
-   machine-readable reporting

They also overlap naturally with browser, integration, and baseline-oriented packages.

#### Possible Product Shapes

Contract testing could eventually appear as:

-   baseline adapters for structured payloads
-   schema-aware assertion helpers
-   integration packages for OpenAPI, GraphQL, or event protocols
-   richer “workflow transcript” comparisons

Overkill probably should not start by inventing a universal contract-testing framework. It should first make sure the engine, baseline model, and artifact identity model are strong enough that such packages can be built cleanly.

### Approval And Golden Workflow Testing

#### How This Differs From Snapshots

At first glance, golden tests look like snapshots. The difference is mostly in scope and semantics.

Ordinary snapshots usually compare a single captured output:

-   a rendered string
-   a DOM fragment
-   a JSON object
-   a screenshot

Golden or master workflow tests often compare a larger structured interaction over time:

-   a CLI session transcript
-   an HTTP exchange sequence
-   a series of emitted events
-   a trace timeline
-   a workflow with multiple steps and intermediate outputs

So the difference is not "snapshot vs not snapshot." The difference is:

-   snapshots often capture one observation
-   golden/master workflows often capture a multi-step narrative artifact

Approval testing is the broader workflow that covers both: print whatever the system observes, save it, manually approve once, and the saved file becomes the spec. Different in spirit from snapshots: snapshots are convenience; approvals are a deliberate ratchet.

#### Why This Matters

A larger workflow artifact usually needs more than simple string equality:

-   step identity
-   normalization rules
-   partial masking or redaction
-   better diffs
-   stale-step detection
-   domain-aware comparison

This pushes the concept toward richer baseline adapters rather than one global snapshot format.

#### Recommended Direction

Overkill should treat golden/master tests as a subtype of baseline-driven testing, but a richer subtype than the default "single string snapshot" mental model.

That means the baseline system should be able to support:

-   structured artifacts
-   multi-step transcripts
-   domain-specific comparison
-   explicit update workflows

#### Concrete Approval Primitives

If approval testing earns its own first-class shape on top of baselines, the concrete primitives worth committing to:

-   a `baseline()` primitive distinct from `expect()`, signalling "I am locking observed behavior, not asserting a known truth"
-   combinatoric input generation (e.g. `baseline(cartesian(values, transforms))`)
-   diff-tool integration on update (open the user's preferred diff tool to review)
-   per-test approval status visible in metadata

Likely package home: `@overkill/baselines` extended, or a separate `@overkill/approval` if the workflow diverges enough.

### Test Data Generation

#### Position

This deserves more thought. It is broader than fixtures, but it should not imply code generation.

For property-based generators specifically (integrated shrinking, splittable PRNGs, classify/coverage), the research-flavored treatment lives in [Research-Stage Techniques § Property-Based Testing](#property-based-testing). This section covers the broader builder/factory direction.

#### What It Could Mean

Test data generation can include:

-   deterministic object builders
-   seeded random data
-   domain-specific factories
-   combinators for valid and invalid values
-   reusable workload generation for integration tests or benchmarks

#### Why It Is Hard

For a TypeScript-first toolchain, the challenge is not generating bytes. The challenge is doing it in a way that remains:

-   type-safe
-   explicit
-   composable
-   deterministic when needed

The concept should probably distinguish:

-   data builders for hand-authored scenarios
-   generated data for broad coverage
-   property-based generators for future advanced testing

#### Recommended Direction

Do not jump directly to a giant faker-style package.

Instead, keep open the possibility of:

-   small builder-oriented helpers
-   seeded generator primitives
-   benchmark workload generation helpers
-   future bridges to property-based testing packages

This area is promising, but it needs deeper research before becoming a settled package concept.

### Deterministic Time And Clocks

The deterministic clock and scheduler story lives in [Deterministic Simulation Testing](../authoring/deterministic-simulation.md), which positions simulators as user- or adapter-owned with Overkill providing the testing integration. Overkill should not ship a first-party clock package; the explicit-injection stance there is consistent with the "Keep Production Code Clean" principle.

### Assertion Budgets

#### Position

This is a plausible future policy tool, not a settled part of the
current assertion model.

#### What It Could Mean

A project-level rule such as `maxAssertionsPerTestCase` could put an
upper bound on how many leaf assertions one test may record.

Possible uses:

-   encourage small, focused microtests
-   make "one assertion per test" an enforceable team policy where a
    team wants that style
-   catch broad "kitchen sink" tests that accumulate many unrelated
    checks instead of splitting into separate cases

#### Why It Is Not Settled Yet

The idea sounds simple, but the tradeoffs are not:

-   some legitimate tests are naturally assertion-dense (tables,
    fixture validation, richer result objects)
-   property helpers and custom assertions complicate what should
    count as "one" assertion
-   it is unclear whether the better abstraction is a hard cap, a
    lint-style warning, or simply stronger guidance in docs

#### Recommended Direction

Keep the current settled model (`plan(n)`, zero-assertion failure,
explicit builder API) and revisit assertion budgets only if real usage
shows that teams want an enforceable upper bound rather than guidance.

### CLI Package (`@overkill/cli`)

#### Position

Several pieces of the concept are CLI-scoped or reporter-scoped
rather than engine/runner concerns: terminal capability detection
(color, animation, progress UI, terminal width), the CLI subcommand
and flag surface itself, argument parsing, help formatting, exit-code
messaging, and stdout/stderr reporter rendering. These currently live
spread across [Runtime Behavior](../architecture/runtime-behavior.md), [CLI Reference](../reference/cli.md), and the reporter docs.

A dedicated `@overkill/cli` package could collect this material
behind one boundary, consumed as a library by the high-level packages
that need it (`@overkill/run`, `@overkill/test`, `@overkill/bench`).
The eventual cut is open.

#### What's Reasonably Clear

In scope with high confidence:

-   terminal capability detection (currently in [CLI Reference § Terminal Capability Detection](../reference/cli.md#terminal-capability-detection))
-   anything depending on `process.stdout.isTTY`, `NO_COLOR`,
    `FORCE_COLOR`, `TERM`, or terminal width
-   stdout/stderr formatting helpers shared across first-party
    reporter packages

#### Open Questions

-   **Library only, or also a binary?** A library consumed by the
    `overkill` binary in `@overkill/run` is the simplest shape.
    Hosting one or more binaries inside `@overkill/cli` itself is a
    separate decision.
-   **Argument parsing and help formatting in scope?** Natural fits,
    but couple `@overkill/cli` to the surface defined in [CLI Reference](../reference/cli.md).
-   **Where does [CLI Reference](../reference/cli.md) end up?** Currently the CLI reference;
    likely the spec doc for `@overkill/cli` if that package lands.
-   **Other CLI/reporter-scoped content scattered across the concept
    docs has to be identified before the boundary can be drawn.**
    The concepts have to be searched for other such topics that
    might belong in `@overkill/cli` — sweep [Runtime Behavior](../architecture/runtime-behavior.md),
    [Package Architecture § Reporters](../architecture/package-architecture.md#reporters), [Failure Artifacts](../authoring/failure-artifacts.md)
    output-capture sections, and the reporter docs for content
    that fits here rather than where it currently lives.

#### Recommended Direction

Capture the idea; leave the cut open. As more content is identified
as CLI-scoped, gather it into [CLI Reference](../reference/cli.md) so the eventual extraction
becomes obvious.

## Research-Stage Techniques

Most JS test runners normalize a small subset of techniques: example
tests, sometimes snapshots, sometimes a thin property-test layer. The
wider testing literature has many more shapes that are well established
in other ecosystems and largely missing from JS/TS. This section
surveys them and identifies the kernels Overkill should preserve as
future package families or first-class test kinds.

The goal is not to ship all of these. It is to ensure the architecture
stays _open_ to them, with the engine, identity, baseline, and reporter
contracts strong enough that adding any one is a matter of writing a
package.

### Property-Based Testing

Overkill should treat property-based testing as more than "random inputs +
shrink." Concrete commitments worth making explicit:

-   **Integrated shrinking** — generators yield rose trees `{ value, shrinks: () => Iterable<Tree<T>> }`, not separate `shrink` functions.
    Hedgehog-style. Avoids fast-check's invariant-breaking shrinking
    pitfalls.
-   **Splittable pseudo-random number generators (PRNGs)** — see
    [Capability Handles](../authoring/capability-handles.md). Each generator derives its own child random
    stream instead of sharing one global source of randomness, so parallel
    and tree-shaped generation stays reproducible. SplitMix is the canonical
    algorithm.
-   **Coverage / Classify / Label** — generators report distribution; a
    property fails not only on a counterexample but also when its input
    distribution drifts (`cover 30 isSorted`).
-   **Witness-replay artifacts** — `*.witness.json` per failing
    property; reruns load the witness and reproduce bit-for-bit. See
    [Failure Artifacts § Witnesses And Replay Artifacts](../authoring/failure-artifacts.md#witnesses-and-replay-artifacts) for the
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

### Metamorphic Testing

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

### Coverage-Guided In-Process Fuzzing

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

### Mutation Testing 2.0

Stryker integration is already planned ([Overkill](../overview.md)). Beyond the basic
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

### Differential Testing

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

What a fuller Overkill treatment would need:

-   an explicit notion of compared subject roles (`candidate`, `reference`,
    `legacy`, `naive`, `polyfill`) so reports explain the mismatch in
    domain language instead of `left`/`right`
-   shrinking that preserves both the input and any runtime dimensions
    needed to reproduce the mismatch
-   a witness artifact that records both outputs plus any attached logs or
    transcripts needed to understand why they diverged
-   optional asymmetry in the relation: exact equality for some fields,
    tolerances or projection functions for others

Likely package direction if this graduates:

-   a small `@overkill/differential` layer above the future property package
-   authoring centered on `differential(...)` or `compareAgainst(...)`
    rather than on hand-written nested loops
-   reusing the same witness/replay and artifact model as other generated
    test families

### Hyperproperties / 2-Trace Properties

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

Concrete use-cases worth naming:

-   constant-time or near-constant-time behavior for auth / crypto paths
-   information-flow checks such as "changing the secret must not change the
    public log/output shape"
-   fairness or starvation checks where two comparable schedules should not
    diverge beyond an explicit bound
-   cache-behavior or scheduling checks where equivalent public inputs should
    not produce materially different observable latency classes

What a serious Overkill treatment would need:

-   paired or multi-trace generators rather than a single arbitrary input
-   witness artifacts that record all compared traces, not just one failing
    sample
-   explicit measurement policy for noisy domains: sample count, tolerated
    delta, percentile or histogram rule, and machine comparability metadata
-   a verdict model that distinguishes "clear relational failure" from
    "measurement too noisy to decide"

Likely package direction if this ever graduates from research note to real
surface:

-   build on top of the future property-testing layer rather than beside it
-   expose primitives such as `hyperproperty(...)` or a more explicit
    `compareTraces(...)`
-   reuse the same witness / replay artifact model where possible, extended
    to multi-trace evidence rather than single-input counterexamples

This is still research-flavored and not a near-term first package, but it is
now concrete enough to preserve as a real architectural option rather than a
one-paragraph curiosity.

### Linearizability And Consistency Model Checking

Concurrent JS code (workers, `Atomics`, `SharedArrayBuffer`) needs more than
example tests. Porcupine (Go) is the fastest open-source linearisability
checker; Knossos (Jepsen) is the original. Algorithm fits in a few hundred
lines; portable to TS.

Overkill direction: `@overkill/history` checker that, given a recorded
interaction log and a sequential model, decides linearisability. Pairs with
the stateful PBT layer. For users writing code with `Atomics.wait`, this is
the only correctness check that matters.

To make this feel like a real concept rather than a name-drop, the likely
shape is:

-   a test or helper records operation history from concurrent actors
-   the user provides a sequential specification/model
-   the checker decides whether the observed history can be linearized to a
    valid sequential execution
-   on failure, the artifact names the conflicting operations and the
    minimal non-linearizable history prefix

This would likely sit in a dedicated `@overkill/history` or
`@overkill/linearizability` package above the future property/model layer,
not in the engine. The engine only needs stable identity, structured
artifacts, and enough metadata to attribute a failing history back to its
generated scenario and runtime dimensions.

### Chaos Testing In Unit-Test Scope

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

What deeper exploration should answer:

-   which fault injectors belong in the first useful slice: dropped message,
    delayed timer, clock skew, partial write, quota exhaustion, allocator
    failure
-   whether the user writes a one-off injected scenario or a reusable
    `chaosProfile(...)` object that feeds many tests
-   how failures are rendered so the output says which injected fault made
    the case fail, not just that some generated run failed

The likely Overkill direction is not "run chaos against production." It is
"make resilience logic testable in a deterministic local simulation." That
keeps the scope aligned with the rest of the concept set.

### Out-Of-Band Verdicts

Mainstream JS runners model verdicts as `pass | fail | skip`. JUnit5 / pytest
/ TestNG model far more:

-   `inconclusive` — runtime unhealthy; not the test's verdict
-   `not-applicable` — precondition not met; distinct from skip
-   `flaky-detected` — passed only after retry

TAP supports `# SKIP` and `# TODO` directives natively. Overkill should
expose first-class verdicts so CI consumers (and humans) distinguish "this
is broken" from "we couldn't tell" from "this test did not apply in the
current environment."

Explicit non-goal: Overkill should not support verdicts whose purpose is to
let known-broken, incomplete, or flaky tests remain in the suite without
failing. That means no `xfail`/`xpass` workflow and no quarantine verdict in
the first-party concept. Broken tests should be fixed, deleted, or fail
normally.

The split between engine `TestOutcome` (`pass | fail | skip |
inconclusive`) and reporter-facing verdicts is settled (see [Glossary § Test Outcome](../reference/glossary.md#test-outcome) / Test Verdict): engine outcomes stay narrow; richer
verdicts are derived by orchestration from `(outcome, metadata,
runner-error?)`. Adding a new verdict means adding a derivation rule, not
a new engine constructor.

### Test Impact Analysis (TIA)

Microsoft's TIA at scale; Wallaby's per-keystroke variant; Bazel's runfile
graph; Vitest's Vite-graph-based selective rerun. The kernel: maintain a
code→test bidirectional map; on commit, run only affected tests.

**Status: open research.** The current concept does not commit to
shipping a dependency graph. Path-level change detection (`--changed`
in [Metadata And Selection](../architecture/metadata-and-selection.md)) is the baseline; `--watch` reuses
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

### SLO / Latency-Sensitive Testing

Bake p99 budgets into tests, not just into benchmarks. `perf_hooks.Histogram`
gives percentile-stable measurement.

```ts
test('parse is fast', ({ slo }) => slo({ p99: '5ms', samples: 1000 }, () => parseLargeJson(fixture)));
```

Different from benchmarks (which are workload-shaped, calibrated, and
budgeted at suite level). Same metric, two consumers. `@overkill/bench`
already has the measurement plumbing; SLO tests reuse it without paying
benchmark setup costs.

The useful boundary is:

-   an SLO-style test asks "does this one important operation stay within the
    latency budget required for correctness or usability?"
-   a benchmark asks "how does this workload perform across sizes,
    environments, and policies over time?"

That makes SLO tests a better fit for:

-   parser or serializer hot paths with hard latency budgets
-   auth / routing / validation paths where tail latency is part of the user
    contract
-   event-loop-sensitive code where a max stall or p99 stall budget is the
    real requirement

And a worse fit for:

-   broad comparative performance work across many workloads
-   machine-normalized budget tracking
-   deep profiling or benchmark-specific diagnostics that need the full
    `@overkill/bench` harness

If this becomes a real package surface, it should likely:

-   reuse measurement primitives from `@overkill/bench`
-   expose a very small assertion-shaped API (`slo(...)`) rather than a full
    benchmark DSL
-   fail like an ordinary test when the latency budget is violated, with the
    measured percentile/max values attached as structured failure data

This area is worth preserving because it closes a real gap between "unit
tests" and "benchmark suites": teams often care about one latency budget
being upheld continuously, but do not want to spin up a whole benchmark
workflow just to enforce it.

### AI-Augmented Testing

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

Concrete uses worth preserving:

-   propose metamorphic relations or property generators from existing type
    and example information
-   suggest new mutants or equivalence partitions when mutation/coverage
    data shows a blind spot
-   explain a failing witness or shrunk counterexample in terms closer to
    the user domain than the raw diff alone

The boundary should stay strict:

-   AI may assist authoring and diagnosis
-   AI should not become a hidden oracle that silently decides pass/fail
-   every AI-derived claim still has to become an explicit assertion,
    property, relation, or reviewable artifact in the ordinary Overkill
    pipeline

### Time-Travel Debugging

`replay.io` (browser), `rr` (Linux), Wallaby's in-editor time-travel debugger.
A test runner that captures every test as a re-playable trace catches
heisenbugs that only appear once.

For Overkill: don't compete with `replay.io` on browser recording. _Do_
guarantee that any failing test in the deterministic-simulation profile is
reproducible from the recorded seed alone. The witness format from
[Deterministic Simulation Testing](../authoring/deterministic-simulation.md) is already the trace; an external viewer can
play it back.

If this grows beyond deterministic simulation, the useful Overkill-specific
question is not "can the runner build its own universal debugger?" It is
"which replay artifacts should the runner preserve so external debuggers or
viewers can reconstruct a failing run?" The concept should therefore stay
artifact-first:

-   preserve enough scheduling, timing, and injected-event data to replay
    deterministic runs exactly
-   keep the witness/trace format stable enough that external tools can
    build viewers on top of it
-   avoid turning the core runner into a browser-recorder or VM-level
    debugger product

### Tools Worth Tracking

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

These should be re-audited periodically alongside [Candidate Libraries](../research/candidate-libraries.md).

### Recommended Path

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
    [§ Approval And Golden Workflow Testing](#approval-and-golden-workflow-testing)

In-source tests are intentionally **not** in this list: the settled
concept rejects them as the default authoring model and the research
record lives in [Non-Goals § Deferred With Research](./non-goals.md#deferred-with-research) (see also
[Microtests And Capabilities](../authoring/microtests-and-capabilities.md) and [Tests As Values § Recommendation](../authoring/tests-as-values.md#recommendation)).

Item 1 is essentially free given decisions already made. Items 2, 3, 5
are the big architectural commitments. Item 4 (TIA) is open research.
Items 6–11 are package-by-package extensions.

## Scope Note

This doc covers broader product directions kept in view as future
possibilities. Directions that are _rejected for the current concept_
with research preserved (such as `@overkill/world` and in-source tests)
live in [Non-Goals § Deferred With Research](./non-goals.md#deferred-with-research) instead.

## Sources

-   [Hedgehog — Gens N' Roses (Jacob Stanley)](https://github.com/hedgehogqa/haskell-hedgehog/blob/master/doc/gens-n-roses.md)
-   [quickcheck-state-machine](https://github.com/stevana/quickcheck-state-machine)
-   [quickcheck-dynamic (Cardano / IOG)](https://github.com/input-output-hk/quickcheck-dynamic)
-   [PropEr — Targeted Property-Based Testing](https://proper-testing.github.io/papers/issta2017.pdf)
-   [LLMorpheus (GitHub Next)](https://github.com/githubnext/llmorpheus)
-   [Meta — LLM Mutation Testing (InfoQ Jan 2026)](https://www.infoq.com/news/2026/01/meta-llm-mutation-testing/)
