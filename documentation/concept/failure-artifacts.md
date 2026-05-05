# Failure Artifacts

## Purpose

This document defines the concept for artifacts emitted during failures, updates, or diagnostic runs.

## Position

Overkill should treat failure artifacts as first-class outputs of a run, not as reporter-specific accidents.

Examples:

-   captured logs
-   temp files
-   trace or event timelines
-   current-vs-baseline diffs
-   benchmark sample data
-   future browser screenshots or traces

## Core Rule

The core should preserve the structured information needed to build good failure output, but reporters decide how to present it.

That means:

-   a failing assertion is not the same thing as an internal runner error
-   the engine should preserve enough data for either a human-oriented reporter or a machine-oriented reporter
-   reporters may choose very different presentations of the same underlying failure

Examples:

-   a stdout reporter wants concise diff output
-   a JSON reporter wants structured payloads
-   an HTML reporter may want attached artifacts and richer navigation

## Artifact Policy

Artifacts should be:

-   explicitly associated with stable test identities
-   clearly typed
-   reviewable where appropriate
-   discoverable by reporters and integrations
-   optional when the run mode does not need them

## Test Failures Versus Errors

Overkill should keep a clear conceptual distinction:

-   test failure: the test ran and reported unmet expectations
-   runner or infrastructure error: the system could not execute or observe the test correctly

The core should preserve both categories distinctly so reporters can present them differently.

## Retry Interaction

Retries should not be a microtest concept.

For integration-style tests, retries may exist, but failure artifacts should preserve:

-   which attempt failed
-   which attempt finally passed or failed
-   whether artifacts come from the first failure, last failure, or all attempts

This prevents retries from hiding useful debugging evidence.
