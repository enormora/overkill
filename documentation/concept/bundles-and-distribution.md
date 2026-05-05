# Bundles And Distribution

## Why Bundles Exist

Some projects will want several Overkill features together and should not have to manually assemble every package before getting productive.

Bundles are the answer to that convenience need.

## Rule

Bundles are a distribution convenience. Fine-grained packages remain the architectural truth.

That means:

-   docs describe packages first
-   bundles are documented as curated entrypoints
-   a user can always drop down to explicit composition

## Candidate Bundle Shapes

### Micro Bundle

For projects that mainly want pure, capability-restricted microtests:

-   core
-   default test DSL
-   assertion package
-   default reporters
-   microtest capability profiles

### Default Bundle

For teams that want one standard Overkill setup:

-   micro bundle
-   environments
-   orchestration
-   baseline support

### Integration Bundle

For broader system and workflow testing:

-   default bundle
-   richer process and baseline utilities
-   snapshot-friendly capabilities

### Full Bundle

A convenience meta-package for evaluation, onboarding, or organizations standardizing on the full stack.

## Risks

Bundles must not:

-   hide the real package boundaries
-   force every user into an all-in-one framework mentality
-   become the only documented experience
-   make versioning strategy impossible to reason about

## Concept Direction

The docs should preserve both:

-   expert-friendly explicit composition
-   team-friendly curated bundles
