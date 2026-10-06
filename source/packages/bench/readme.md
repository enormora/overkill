# @overkill-dev/bench

Ordinary test-node authoring for the Overkill benchmark package.

Included in the standard `@overkill-dev/test` installation. Standard users
import the same authoring surface from `@overkill-dev/test/bench`; advanced
consumers can install and import `@overkill-dev/bench` directly. Bench code
stays outside root `@overkill-dev/test` imports and ordinary microtest startup.

The current facade exports `test`, `skippedTest`, `suite`, `table`,
`defineMacro`, and `defineParameterizedTestBody`. These are the same
family-neutral constructors used by `@overkill-dev/test`, with the same
assertion, validation, and source-location behavior.

```ts
import { suite, test } from '@overkill-dev/bench';

const fixture = { entries: [ 1, 2, 3, 4, 5 ] };

export const testNode = suite('fixture validation', [
    test('contains the expected entries', (scope) => {
        scope.assert.equal(fixture.entries.length, 5);
        return scope.assert.collect();
    })
]);
```

Nodes compose with ordinary `@overkill-dev/test` suites, tables, and macros.
Creating a node does not execute its body or select a test family.

Public types include `AuthoringAnnotations`, `AuthoringControls`,
`ParameterizedTestScope`, `TableDefinition`, `TableTestBody`, `Suite`,
`Table`, `TestBody`, `TestCase`, `TestNode`, `TestScope`, and
`TestScopeAssertContext`.

This facade does not yet measure performance. `benchmark(...)`, workloads,
measurement strategies, budgets, and `overkill bench` commands are separate
implementation milestones. Advanced authoring and runtime binding
remain available from `@overkill-dev/test` and its resources subpath.
