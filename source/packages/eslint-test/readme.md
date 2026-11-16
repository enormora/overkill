# @overkill-dev/eslint-test

Test ESLint rules and configurations through ESLint's own execution APIs.

`defineRuleTests` provides rule examples and generated properties.
`defineConfigTests` provides independent `.checks()`, `.fixtures()`, and
`.properties()` suite factories. Profiles own execution policy and resources.

```ts
import { defineRuleTests } from '@overkill-dev/eslint-test';
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
ESLint merges base, named, and per-case configurations in that order using its
flat configuration semantics.

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
override. Additional constraints use bounded generation and ESLint option validation. Generation
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

## Configuration tests

```ts
import { defineConfigTests } from '@overkill-dev/eslint-test';
import { config } from './config.ts';

export const configTests = defineConfigTests({
    name: 'project policy',
    configs: { base: config },
    project: { kind: 'virtual', files: {}, dependencies: { kind: 'none' } },
    inventories: [],
    files: [ {
        title: 'JavaScript policy',
        configs: [ 'base' ],
        filename: 'source/example.js',
        expect: {
            kind: 'included',
            rules: { 'no-debugger': 'error', 'no-alert': null },
            ruleMatch: 'subset',
            languageOptions: {},
            settings: {}
        }
    } ],
    fixtures: [ {
        title: 'reject debugging',
        configs: 'all',
        source: { kind: 'inline', filename: 'source/example.js', code: 'debugger;' },
        expect: {
            kind: 'lint',
            diagnostics: { kind: 'rule-ids', rules: 'all', expected: [ 'no-debugger' ] }
        }
    } ],
    generation: []
});
```

Export suite factories from separate test modules to select profiles independently.
Construction performs no project I/O. Named configurations are flat config arrays
or async factories receiving `{ root, signal }`. ESLint owns matching, validation,
merging, and autofixing. Ambient config discovery is disabled.

Inventories declare `title`, `configs`, `target`, `catalog`, `completeness`,
`deprecated`, and `exclusions`. Targets are `{ kind: 'declared' }` or
`{ kind: 'effective', filename }`. Declared inventories inspect explicit entries
across blocks; effective inventories respect matching and ignores. Off counts as
configured. `completeness: 'all' | 'known-only'` controls missing active rules;
`deprecated: 'allow' | 'absent' | 'off'` controls deprecated entries. Exclusions
require `{ ruleId, reason }`. Unknown rules in catalog namespaces fail separately.
Catalogs are `{ kind: 'plugin', namespace, rules }`, using the registered alias,
or `{ kind: 'rules', rules: [{ ruleId, deprecated }] }`. Core catalogs are caller
supplied; for example, derive active names from `@eslint/js`.

File checks expect `{ kind: 'ignored' }` or an included expectation as above.
Severity aliases normalize, `null` requires absence, and `ruleMatch: 'exact'`
checks all configured names. Language options and settings are partial
expectations; a supplied parser is compared by identity.

Fixture sources are inline or `{ kind: 'file', filename }`. Diagnostic expectations
are `clean`, `rule-ids`, or `messages`. Message expectations are ordered partial
diagnostics, with optional string or regular-expression messages. Rule selection
is explicit. Fatal parsing errors cannot be hidden by filtering; deliberate
failures use `{ kind: 'parse-failure', message }`. Unexpected ignored files fail.

`expect: { kind: 'fix', diagnostics, output }` checks native autofix output;
output is `{ kind: 'text', text }` or `{ kind: 'file', filename }`.
`expect: { kind: 'custom', check(observation, scope) }` supports ordinary assertions
and existing Overkill snapshots. Return the callback's assertion result, as in a
normal test body. Observations contain original and fixed
diagnostics, code, output, and a relative filename. Temporary roots in diagnostic
text normalize to `<project>`. Authored fixture files are never overwritten.

## Project contexts and generated config properties

Existing projects use `{ kind: 'existing', root: absolutePath }` and stay read-only.
Virtual projects declare relative file paths and contents, including supporting
modules and `tsconfig.json` when needed. To reuse installed dependencies, select
`dependencies: { kind: 'from-project', root: absolutePath }`. This links existing
`node_modules` without installing packages. Files cannot escape the project or
declare `node_modules`. Acquisition and cleanup use Overkill resources and normal
profile filesystem capabilities. Config factories can use `root` for parser
settings such as `tsconfigRootDir`.

Generation targets declare `title`, `configs`, `project` (virtual), and `generator`.
Built-in generation uses
`{ kind: 'syntax', syntax: 'javascript' | 'typescript', filename }`.
Custom generation uses `{ kind: 'custom', input }`, where an Overkill generator
returns `{ filename, code, files }`; `files` contains generated companion files.
Every trial gets a fresh project and ESLint instance. Source is written before
parsing so TypeScript project services observe the actual trial.

For `@typescript-eslint/parser`, use `parserOptions.projectService` or set
`parserOptions.disallowAutomaticSingleRunInference: true` with `project`.
Config contracts parse and lint each input separately; single-run inference in
CI otherwise switches later passes to an isolated program without companion types.

Defaults are crash freedom, autofix syntax safety, and suggestion syntax safety.
Explicit `contracts` replace the defaults:

```ts
contracts: [
    { kind: 'crash-freedom' },
    { kind: 'fix-syntax' },
    { kind: 'suggestion-syntax' },
    { kind: 'fix-stability', maxRounds: 2 },
    { kind: 'repeatability' }
];
```

Fix stability counts complete native autofix runs. Repeatability compares
diagnostics and output across fresh projects; imported plugin module state is
shared. Syntax safety retains the configured language and processors with rules
disabled. These contracts do not establish semantic equivalence.

Each contract is a separate property case. Applicable fixtures seed properties
without transferring diagnostic expectations. Async project parsing selects a
valid input from a batch of eight ordinary generated candidates. Keep `maxSize`
at least eight to permit the batch. Generation uses normal work budgets; a trial
with no accepted candidate is inconclusive. Configuration and rule exceptions
fail instead of becoming rejected candidates. Profiles own trial and shrink
budgets. Replays store relative inputs and fixture identities, never temporary roots.

Export config properties into a dedicated integration-profile module. They need
filesystem access to create trial projects and explicit property budgets:

```ts
profiles: {
    configLaws: {
        testFamily: 'integration',
        files: { include: [ 'test/config-laws.test.ts' ] },
        execution: { processModel: 'supervised-process' },
        property: { newTrials: 50, maxWork: 100_000 },
        timeouts: { softMilliseconds: 10_000, hardMilliseconds: 15_000 }
    }
}
```

Worker pools are also supported. Confirmed failures retain ordinary property
witnesses for `overkill replay-witness`; replay creates a fresh trial project.
