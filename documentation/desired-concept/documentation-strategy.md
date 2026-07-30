# Documentation Strategy

## Purpose

This document captures how the user-facing Overkill documentation should be
structured.

The guiding problem is clear: Overkill wants to support advanced mechanics
without overwhelming new users or making the product look larger than it
needs to be.

## Principle

The documentation should reflect the low-API-surface principle.

That means:

- show the common path first
- keep advanced mechanics discoverable but not foregrounded
- document layers separately so users only learn the layer they need

## Documentation Layers

The user-facing documentation should be organized in layers.

### 1. Quick Start

Show only the smallest useful first-party path:

- write a simple test
- run it
- read a failure

Do not introduce advanced helpers here.

### 2. Core Concepts

Introduce only the concepts most users need early:

- tests as values
- `assert` / `require`
- `case`
- macros
- microtests versus integration-style tests

### 3. Common Workflows

Focused guides for the common day-to-day tasks:

- writing fast microtests
- organizing suites and macros
- using doubles
- enabling coverage
- adding reporters

### 4. Advanced Topics

This is where the rarer mechanics belong:

- `defineHarness(...)`
- transcript recording
- reusable multi-case macros
- `inFlight(...)`
- queue-flush helpers
- benchmark workloads and policies
- browser metrics backends

These should exist, but they should not be in the first screenful of the
main documentation.

### 5. Reference

Reference documentation should be complete and searchable, but not the main
learning path.

### 6. Background Research

Comparisons, candidate-library audits, and prior-art notes should live
outside the main user-facing concept and guide flow.

They are useful for maintainers and contributors, but they should not be
mixed into the primary product explanation or treated as part of the settled
user-facing concept surface.

## API Presentation

The API overview should not dump every helper equally.

Prefer:

- a short “start here” API list
- separate advanced reference pages
- package-by-package reference sections

Avoid:

- one giant flat API index that makes Overkill look bigger than it is
- presenting every advanced helper as required knowledge

## Progressive Disclosure

Progressive disclosure should be intentional:

- beginners see tests, assertions, and running
- intermediate users see doubles, macros, baselines, and reporters
- advanced users find harnesses, recording, flush helpers, mutation,
  browser-performance metrics, and custom assertion references

## Examples

Examples should prefer:

- `case` over `t`
- no inline destructuring by default
- realistic but small examples
- one concept per example

Advanced examples can compose multiple concepts, but basic examples should
not.

## What To Avoid

The documentation should avoid:

- leading with the full package graph
- leading with every possible test style
- leading with every advanced utility
- assuming users want framework-level ceremony for small tests
- mixing settled product guidance with exploratory or research-stage notes

Overkill should feel smaller than its internal architecture.

## Concept Documentation Shape

Internal concept documentation in `documentation/concept/` follows a
canonical section order:

1. `# Title` — matches the filename closely
2. `## Purpose` — what the document is for and what decision it owns
3. `## Position` — where the document fits inside a larger system flow
4. Body sections in title case
5. `## Cross-References` — relative links to sibling concept
   documents, grouped under one H2 with H3 subsections when several
   are needed
6. `## Influences` — prior art whose ideas informed the design;
   always plural
7. `## Sources` — external references cited inline; always last

Every section except the title is optional.

### Heading Conventions

- Title-case all headings, including short words like "And", "Or",
  "For", "With", "Of".
- Filenames are lowercase-hyphenated and should match the H1
  closely.
- Do not embed markdown links in heading text — keep headings plain
  and link in the body.
