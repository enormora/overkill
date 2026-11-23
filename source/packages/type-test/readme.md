# `@overkill-dev/type-test`

Check type relationships in your original TypeScript project. The optional
package provides an analysis family for the runner and the public engine API.
Compiler code loads when you prepare the selected family.

## Run your first type test

Use Node.js 26.9 or later in the 26.x series. Install the standard authoring
and CLI package, the type-test package, and the supported compiler under an
alias:

```sh
npm install -D @overkill-dev/test @overkill-dev/type-test typescript-beta@npm:typescript@7.1.0-beta
```

Set `"type": "module"` in `package.json` for this example. Create
`source/identity.types.mts`:

```ts
import { test } from '@overkill-dev/test';
import { sameType } from '@overkill-dev/type-test';

function identity<Value>(value: Value): Value {
    return value;
}

export const testNode = test('preserves literal inference', (scope) => {
    const result = identity('hello' as const);
    scope.assert(sameType<typeof result, 'hello'>());
    return scope.assert.collect();
});
```

Include the test in the compiler project. For this example, use this
`tsconfig.json`:

```json
{
    "compilerOptions": {
        "module": "NodeNext",
        "target": "ESNext",
        "strict": true,
        "skipLibCheck": true,
        "types": []
    },
    "include": ["source/**/*.types.mts"]
}
```

Create `overkill.config.ts` with a named runner profile:

```ts
import { defineConfig } from '@overkill-dev/test/config';
import { family } from '@overkill-dev/type-test';

export const config = defineConfig({
    profiles: {
        types: {
            testFamily: family,
            files: { include: [ 'source/**/*.types.mts' ] },
            settings: {
                projectConfigPath: './tsconfig.json',
                compiler: {
                    kind: 'package',
                    specifier: 'typescript-beta',
                    version: '7.1.0-beta'
                }
            }
        }
    }
});
```

```sh
npx overkill list --profile types
npx overkill run --profile types
```

The imported `family` value selects analysis for the profile. The runner's
`files.include` discovers test modules. The TypeScript configuration defines the
compiler project and its dependency graph.

## Choose an installed compiler

`projectConfigPath` resolves from the project root and must point to an existing
configuration. TypeScript uses its options, inherited configuration, project
references, and module resolution.

- `{ kind: 'local' }` resolves the project's installed `typescript`.
- `{ kind: 'package', specifier, version }` resolves an installed specifier from
  the same root and checks the reported version exactly. An npm alias lets the
  checker use a different installation from the project's build.
- `{ kind: 'matrix', compilers: [...] }` takes a nonempty list of local or package
  selections. It preserves first occurrence order and deduplicates only when
  canonical installation and fingerprints agree. Distinct implementations
  claiming the same version are rejected. Each compiler variant has its own
  executable work ID and shares the logical case ID.

Only `7.1.0-beta` is supported. Missing packages, version mismatches, and
unsupported versions fail preparation. Install the compiler before running
checks. After changing its implementation, restart the execution host so Node
loads the new compiler modules.

## Write assertions

The root exports `family`, `sameType`, `assignableTo`, and `assignableFrom`.
Its type exports are `CompilerSelection`, `CompilerPolicy`,
`TypeTestSettings`, `TypeAssertionReference`, `TypeRelationBindings`, and
`TypeRelation`.

Each relation supports the following forms inside a case body:

| Form                | Example                                                   |
| ------------------- | --------------------------------------------------------- |
| Two type arguments  | `scope.assert(sameType<Actual, Expected>())`              |
| Actual expression   | `scope.assert(sameType.withActual<Expected>(), actual)`   |
| Expected expression | `scope.assert(sameType.withExpected<Actual>(), expected)` |
| Two expressions     | `scope.assert(sameType.expressions, actual, expected)`    |

Put `.not` immediately after the relation name in any form, as in
`scope.assert(sameType.not.expressions, actual, expected)`. An inconclusive
relation stays inconclusive under negation.

`assignableTo` asks whether actual is assignable to expected under the project's
compiler options. `assignableFrom` asks whether expected is assignable to actual.
`sameType` compares structure while preserving distinctions such as literal
types, optional and readonly members, and nominal declaration identity.
Equality is inconclusive when recursive expansion exceeds 256 comparison levels.
Expression operands use the types at their authored locations. For calls,
constructors, and generic inference, write the TypeScript expression and assert
its inferred type, as in the quickstart.

### Source requirements

Provide the original callback source in the configured compiler project. For
precompiled tests, keep the original sources available and enable ordinary
source maps so Node can resolve the original locations. The checker reads those
sources directly. It emits no outputs and uses existing declaration outputs
when required by the project's reference configuration.

Module initialization and test tree construction run during discovery. The
checker analyzes case bodies and their expressions without executing them.
Generic macro bodies keep their authored constraints, and table rows share
their body's static parameter type. Shared assertion sites count for each
selected owner.

Use a statically identifiable callback and a direct `scope.assert` boundary
with a package relation reference. Import aliases work. Dynamic reference
selection, detached assertion methods, scope forwarding, nested assertion
callbacks, and mixed runtime assertions are unsupported. These references are
assert-only. Runtime invocation throws.

The catalog provides three type relations. TSX and decorators follow the
project's compiler configuration. Use TypeScript's `@ts-expect-error` directive
when any diagnostic on the next line is sufficient. TypeScript reports unused
directives.

## Run directly through the engine

Install `@overkill-dev/engine` alongside the type-test package and compiler
when using the engine without the standard authoring package. This example
uses the package-level functions of the default engine. Use the same engine
for root creation, preparation, and execution.

Install `@types/node` as a development dependency and set
`compilerOptions.types` to `["node"]` for this example. Save it as
`source/direct.mts` and add that path to `include` in `tsconfig.json`. Run
`node source/direct.mts` from the project root.

```ts
import * as engine from '@overkill-dev/engine';
import { family, sameType } from '@overkill-dev/type-test';

const metadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ] as const
};
const root = engine.createRoot({
    ...metadata,
    title: 'type tests',
    children: [
        engine.createTestCase({
            ...metadata,
            title: 'preserves the literal type',
            body(scope) {
                const value = 'hello' as const;
                scope.assert(sameType<typeof value, 'hello'>());
                return scope.assert.collect();
            }
        })
    ]
});
const signal = new AbortController().signal;

await using prepared = await engine.prepareFamily({
    testPlan: engine.createTestPlan(root),
    testFamily: family,
    settings: {
        projectConfigPath: './tsconfig.json',
        compiler: { kind: 'package', specifier: 'typescript-beta', version: '7.1.0-beta' }
    },
    projectRoot: process.cwd(),
    signal
});
const collected = await prepared.collect({
    workIds: prepared.testPlan.cases.map((testCase) => testCase.workId),
    signal
});
const result = await engine.execute(collected, {
    execution: { mode: 'serial-in-process' },
    debug: { mode: 'off' },
    retryPolicy: null,
    reporters: [],
    runFacts: {},
    startedAt: new Date().toISOString(),
    signal
});
console.log(result.status);
```

Supply an absolute `projectRoot`. Select a nonempty subset of the expanded
`workId`s to check fewer cases. Each preparation supports one collection and
one execution. The engine disposes compiler sessions on collection failure
and after execution. `await using` also releases an abandoned preparation.

Direct callers can use `AbortSignal.timeout` for phase deadlines and
`AbortSignal.any` to combine a deadline with caller cancellation. Runner
profiles use `timeouts.collectionMilliseconds` for preparation and
collection and `timeouts.softMilliseconds` for checking. On Linux and macOS,
supervised analysis can enforce one `timeouts.hardMilliseconds` budget from
assignment through compiler shutdown. In-process cancellation is cooperative.

Coverage, runtime debug recording, runtime resources, body retries, and
worker-pool execution are unsupported. Each run or watch rerun prepares the
original project again.

## Read diagnostics

| Situation                                     | Result                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Missing configuration or unavailable compiler | Setup error                                                                         |
| Authored skip                                 | Skipped without inspecting the body                                                 |
| Resolved body with zero assertion sites       | `no-assertions` failure                                                             |
| False relation                                | Assertion failure at the original call site with operand types and compiler version |
| Unsupported or unresolved source or relation  | Inconclusive unless another relation fails the case                                 |
| TypeScript diagnostics or checker failure     | Run error and inconclusive cases for the affected compiler                          |
| Observed inputs change during the run         | The invocation's evidence is invalidated. Run again with fresh preparation.         |

Only selected cases contribute assertion evidence. TypeScript can still report
diagnostics anywhere in the original project, including unselected source.
The type-test adapter artifact retains site evidence and diagnostics, including
inconclusive sites in a case that already failed.

## Reproduce a recorded run

```sh
npx overkill run --profile types --record
npx overkill history list
npx overkill replay <run-id>
```

Use the ID of a retained detailed record. A profile can also set
`runRecords: { persist: 'always' }` to retain replay details by default.
Records preserve the family implementation, settings, compiler variants,
project and observed input fingerprints, assertion ownership, and outcomes.
Replay uses the recorded selection and validates the family implementation,
installed compiler identity, and original inputs before checking. After
changing a compiler, source file, or configuration, start a fresh run.
Historical results can still be inspected without loading the compiler.

Use `npx overkill run --profile types --last-failed` to start a fresh run
with the failed compiler variants selected from compact history.
