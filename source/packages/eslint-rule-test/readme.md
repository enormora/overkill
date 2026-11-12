# @overkill-dev/eslint-rule-test

Define ESLint examples and generated properties from one reusable definition.

```ts
import { defineRuleTests } from '@overkill-dev/eslint-rule-test';
import rule from './no-foo.ts';

export const ruleTests = defineRuleTests({
    name: 'no-foo',
    rule,
    configs: { modern: { languageOptions: { ecmaVersion: 'latest' } } },
    valid: [ 'bar()' ],
    invalid: [ { code: 'foo()', errors: [ { messageId: 'unexpectedFoo' } ] } ]
});
```

Export `ruleTests.examples()` as `testNode` in a microtest module. Export
`ruleTests.properties()` in a separate property-profile module. Both methods
construct fresh ordinary Overkill trees; calling one does not register the other.

Share `configs` as an imported object across rules. Cases use all named configs
by default. `defaultConfigs` narrows the suite default. A case can override it
with `configs: ['modern']`, `configs: 'all'`, or `configs: 'base'` to run once
without a named overlay. With an empty map, cases use base configuration.

Exact examples check diagnostic, fix, and suggestion expectations through
ESLint's in-memory `Linter` API. Failure formatting needs no filesystem access. Hooks,
exclusive cases, skips, and dependency constraints are rejected. Compose ordinary
Overkill nodes to express execution policy.

Properties automatically generate source and schema-valid rule options. Original
examples retain their expectations; generated inputs check crashes, fixed syntax,
and suggestion syntax. They do not infer correct diagnostic classifications.
Property profiles own budgets, seeds, shrinking, and reproduction.

`generation` accepts `syntax: 'javascript' | 'typescript'`, `filename`, and
`convergence: { kind: 'disabled' }` or `{ kind: 'bounded', maxPasses: 10 }`.
TypeScript generation requires a supplied TypeScript parser. Put `generation`
on a named configuration to select its dialect and filename independently. An explicit
`generation.input` Overkill generator replaces automatic input production.

Automatic source generation covers variable declarations, functions, classes,
objects, control flow, expressions, arrays, and TypeScript interfaces, aliases,
enums and annotations. Syntax models shrink before printing; parser validation
preserves valid syntax throughout shrinking. Schema generation supports
primitives, enums, tuples, arrays, objects, unions and local references. External
references, pattern properties, dependencies and unknown keywords require an
override. Additional constraints use bounded generation and schema validation. Generation
errors fail construction; bounded search exhaustion remains inconclusive.

In-memory parsers need no resources. Parsers performing external I/O remain
subject to the chosen profile's capability restrictions.

A dedicated property profile keeps the generated modules separate from examples.
Program generation costs more traversal work than scalar generators. This preset
bounds edge exploration and reserves enough work for 100 generated trials:

```ts
profiles: {
    ruleProperties: {
        testFamily: 'property',
        timeouts: { collectionMilliseconds: 10000, softMilliseconds: 10000, hardMilliseconds: 15000 },
        files: { include: ['test/**/*.rule-property.test.ts'] },
        property: {
            newTrials: 100,
            maxAutomaticEdges: 8,
            maxExhaustiveValues: 0,
            maxWork: 100000,
            maxShrinkWork: 10000
        }
    }
}
```

Exhaustive exploration is disabled here because program and option spaces are
large. Budgets remain ordinary profile policy; the adapter does not override
profile limits. An exhausted budget produces inconclusive, never a passing law.
