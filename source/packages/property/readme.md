# `@overkill-dev/property`

Property test authoring. Included in `@overkill-dev/test` through its
`@overkill-dev/test/property` subpath.

## Authoring

`property({ title, generator, test })` creates one property-family `TestCase`,
usable directly or inside `suite(...)`. Its callback receives the generated
value and a property-local assertion scope, and returns an `AssertionResult`.

`withProperties(body)` wraps an ordinary test body with typed
`scope.forall(generator, body)` authoring. Nested invocations stay inside the
enclosing case; they never register runtime subtests. Unconfigured rewrapping preserves the
original declaration; configured rewrapping is rejected during collection. Base test scopes have no `forall` method.

Generator values are owned by Overkill. Custom generators compose its fluent
`map`, `flatMap`, `filter`, and `withCodec` surfaces. Sampling callbacks and
unbranded objects are not generators.
Their private runtime symbol and shared declaration identity remain compatible
across leaf and standard package copies.

## Current availability

Construction and collection are supported. They retain generator and callback
declarations without executing them. Property profiles resolve and validate policy during collection. Generator
constructors and trial execution are not implemented yet. Executing a property declaration
fails explicitly before user callbacks or resource acquisition.

The standard subpath exposes the same authoring functions and types as this
package. Property modules stay outside the root test import and ordinary
microtest startup.

## Profile policy

Configure a project-owned profile and select it with `overkill run --profile laws`:

```ts
import { defineConfig } from '@overkill-dev/test/config';

export const config = defineConfig({
    profiles: {
        laws: {
            testFamily: 'property',
            files: { include: [ 'test/**/*.property.ts' ] },
            property: { newTrials: 200, maxWork: 20_000 }
        }
    }
});
```

Properties use microtest-like capability restrictions. Resource descriptors,
authored capture controls, retries, and code coverage are rejected. The default
execution is supervised and concurrent, with a 1 s soft timeout and 2 s hard
timeout. In-process execution supports best-effort diagnostics without hard
termination. Process usage policy uses the ordinary `processUsage` surface.

`property({ title, generator, test, settings })` and
`withProperties(body, settings)` override exploration defaults. All nested
`forall` calls inherit the wrapper's collected policy. Settings cannot change
capabilities, timeout policy, or process budgets. Limits must be finite safe
integers; unknown settings and configured rewrapping fail during collection,
even when selection would exclude the declaration.

| Setting               | Default |
| --------------------- | ------: |
| `newTrials`           |     100 |
| `maxSize`             |     100 |
| `maxDepth`            |      10 |
| `maxAutomaticEdges`   |     100 |
| `maxExhaustiveValues` |   1,000 |
| `maxWork`             |  10,000 |
| `maxShrinkWork`       |   1,000 |
| `maxLabels`           |     100 |
| `maxRetainedInputs`   |     100 |

`newTrials`, `maxWork`, `maxLabels`, and `maxRetainedInputs` must be positive.
Other limits permit zero. Exploration settings may exceed profile defaults;
timeouts and process budgets remain profile-owned. The total work budget
covers every phase, including generation, reconstruction, rejections,
duplicate processing, confirmations, and body evaluations. Shrink work also
consumes total work. This milestone collects the budgets; trial execution and
shrink accounting follow in their execution milestones.
