# Reproducibility

## Purpose

This document defines what Overkill should mean by a reproducible run.

## Position

Reproducibility is not only about random seeds. It is about whether a run can be re-created with meaningfully the same inputs, ordering, environments, and artifact expectations.

## Reproducibility Inputs

At minimum, a reproducible run should be able to capture:

-   seed
-   selected files and test ids
-   resolved environment matrix
-   resolved execution profile
-   baseline update mode
-   benchmark workload identity and calibration inputs where relevant

## Ordering

If ordering is randomized, the ordering must be replayable.

That implies:

-   reproducible seed handling
-   stable test identities
-   deterministic expansion of parameterized and environment-driven cases

## Artifact Reproducibility

Artifact-related operations should also be reproducible where practical:

-   baseline lookup
-   stale-baseline detection
-   benchmark budget resolution
-   failure artifact association

## Scope

Overkill should not promise impossible bit-for-bit reproducibility across all machines or operating systems.

It should promise reproducible run intent and reproducible run planning.

That is enough to make:

-   failures debuggable
-   randomization replayable
-   baseline changes reviewable
-   benchmark policies meaningful
