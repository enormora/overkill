# Concept Status Vocabulary

## Purpose

The concept docs use several status words — "settled", "speculative",
"deferred", "open research", "future direction" — without a single page
defining them. This doc fixes that.

The status of a section determines how much weight a reader should
give it. Settled material is load-bearing. Speculative material is a
direction. Research material is an open question. Without that
distinction, readers cannot tell which sentences are decisions and
which are sketches.

## Statuses

### Settled

A decision is _settled_ when:

-   the shape is decided
-   the rationale has been written down
-   reversing the decision requires explicit justification, not just
    preference

Settled material is the source of truth. The canonical home for a
settled concept is normative — other docs link to it instead of
restating it.

Examples in the current concept set:

-   the `assert` / `require` split (settled in
    [Assertions And Results](../authoring/assertions-and-results.md))
-   the capability profile model (settled in
    [Microtests And Capabilities](../authoring/microtests-and-capabilities.md))
-   the four-case `TestOutcome` ADT (settled in
    [Assertions And Results § The Protocol Shape](../authoring/assertions-and-results.md#the-protocol-shape))

### Speculative

A direction is _speculative_ when:

-   the shape is reasonably clear
-   the case for it has been written down
-   nothing has been committed yet, and the design may change
    materially when it is built

Speculative material is a working hypothesis. Future implementation
work may confirm, refine, or reject it.

Examples:

-   [Ideas And Future Directions § Future Directions With Known Shape](../decisions/ideas-and-future-directions.md#future-directions-with-known-shape)
-   the `@overkill/cli` package extraction
-   the approval-test workflow as a baseline subtype

### Research

A topic is at _research_ status when:

-   the underlying mechanism, ergonomics, or integration still needs
    investigation
-   any concrete API is illustrative, not a commitment
-   building a real package would require a prior research phase

Research material exists so the architecture stays _open_ to the
direction. The goal is not to ship all of these. It is to ensure
the engine, identity, baseline, and reporter contracts are strong
enough that any one could be added later.

Examples:

-   [Ideas And Future Directions § Research-Stage Techniques](../decisions/ideas-and-future-directions.md#research-stage-techniques)
-   linearizability checking, hyperproperties, coverage-guided fuzzing
-   true test-impact analysis with a persisted dependency graph

### Deferred With Research

A direction is _deferred with research_ when:

-   it is rejected for the current concept
-   the research that informs the rejection is preserved
-   the rejection may be revisited if the surrounding constraints
    change

Deferred-with-research material is a record. It explains _why_ a
direction was not pursued so future contributors do not have to
re-derive the answer.

Examples:

-   [Non-Goals § Deferred With Research](../decisions/non-goals.md#deferred-with-research)
    — `@overkill/world`, in-source tests
-   xfail / xpass verdicts (rejected for the verdict layer, research
    preserved in [Ideas And Future Directions § Out-Of-Band Verdicts](../decisions/ideas-and-future-directions.md#out-of-band-verdicts))

### Reading Aid

A doc or section is a _reading aid_ when:

-   it does not introduce new mechanism
-   it threads or walks through canonical specs that live elsewhere
-   removing it would not change any decision

Reading aids deliberately overlap with the canonical docs. They
exist to make the canonical material easier to follow on a first
read.

Examples:

-   [Composition Order](../architecture/composition-order.md) — the
    plan-time and execution-time stages tour
-   [Failure Walkthrough](../authoring/failure-walkthrough.md) — a
    worked example threading assertion → identity → witness → reporter

Reading aids should declare themselves as such near the top.

### Reference

A doc is _reference_ when its job is lookup rather than narrative.

Examples:

-   [Glossary](../reference/glossary.md)
-   [Types Index](../reference/types-index.md)
-   [CLI Reference](../reference/cli.md)

Reference material may overlap with canonical specs by design, but
the spec remains the source of truth; the reference is the lookup
view of it.

## How To Apply A Status

When writing or editing a concept doc:

-   say the status if it is not obvious from the doc's folder. A doc
    in [`decisions/`](../decisions/) is settled by default; a doc in
    [`research/`](../research/) is research by default; a section
    inside an otherwise settled doc may still be speculative.
-   when downgrading a doc from settled to speculative (or upgrading
    from research to speculative), record the change so the next
    reader can see it happened.
-   prefer one canonical home per concept. The status of that home is
    the status of the concept; other docs that mention it should not
    contradict the home's status.

## Where The Statuses Are Currently Used

The four content statuses (settled, speculative, research,
deferred-with-research) map to the doc set as follows:

| Folder          | Typical status                                            |
| --------------- | --------------------------------------------------------- |
| `decisions/`    | mostly settled; some sections speculative or research     |
| `architecture/` | settled                                                   |
| `authoring/`    | settled; some forward-looking sections marked speculative |
| `reference/`    | reference (lookup view of settled material)               |
| `research/`     | research / comparison                                     |
| `meta/`         | meta (about the docs themselves)                          |

The two view statuses (reading aid, reference) apply to specific docs
inside the folders, not to whole folders. Two docs currently declare
themselves reading aids:
[Composition Order](../architecture/composition-order.md) and
[Failure Walkthrough](../authoring/failure-walkthrough.md).
