# `@overkill-dev/type-test`

Optional compiler-backed assertions. Install this package and provision TypeScript
`7.1.0-beta` explicitly. Checking never installs or downloads compilers.

```sh
npm install -D @overkill-dev/type-test typescript-beta@npm:typescript@7.1.0-beta
```

## Profiles

```ts
import { defineConfig } from '@overkill-dev/test/config';
import { family } from '@overkill-dev/type-test';

export const config = defineConfig({
    profiles: {
        types: {
            testFamily: family,
            files: { include: [ 'source/**/*.types.ts' ] },
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

Run `overkill run --profile types` or `overkill list --profile types`.
The package is separate from `@overkill-dev/test`; imports do not register families.
Compiler and checker code load only when preparing an explicitly selected family.

## Relations

The root exports `family`, `sameType`, `assignableTo`, and `assignableFrom`,
plus compiler settings and assertion-reference types. Ability matchers, `_`,
and the former `/profile` and `/check` subpaths have been removed.

```ts
scope.assert(sameType<Actual, Expected>());
scope.assert(assignableTo.withActual<Expected>(), actual);
scope.assert(assignableFrom.withExpected<Actual>(), expected);
scope.assert(sameType.expressions, actual, expected);
scope.assert(sameType.not<Actual, Expected>());
scope.assert(sameType.not.expressions, actual, expected);
```

Each relation supports all four forms and `.not`. `assignableTo` asks whether
actual is assignable to expected; `assignableFrom` reverses that direction.
Expressions supply types at their source locations. Analysis never executes
case bodies or expression side effects. References accept `scope.assert`,
not `scope.require`; ordinary runtime use throws.

## Installed compiler selection

`projectConfigPath` resolves against the explicit project root. The actual
configuration, inherited options, references, and module resolution are captured;
a missing configuration fails preparation.

`{ kind: 'local' }` resolves the project's installed `typescript`.
`{ kind: 'package', specifier, version }` resolves an installed package alias
from the same root and requires its exact reported version. Only `7.1.0-beta`
is supported. Other releases, missing packages, and version mismatches fail
preparation without fallback. The old `kind: 'version'` selection is rejected.

A nonempty `{ kind: 'matrix', compilers: [...] }` preserves first occurrence
order and deduplicates entries only when canonical installation and fingerprints
agree. Distinct implementations claiming the same version are rejected.
Variants retain logical case identity and add compiler identity to executable work.
Preparation facts include the installed compiler, implementation fingerprints,
original project configuration, and observed inputs. Changed inputs require fresh
preparation. Compiler implementation changes require restarting the execution
host, because Node retains imported compiler modules.

## Direct engine execution

Use the engine that created the root:

```ts
await using prepared = await engine.prepareFamily({
    testPlan: engine.createTestPlan(root),
    testFamily: family,
    settings,
    projectRoot,
    signal
});
const collected = await prepared.collect({
    workIds: prepared.testPlan.cases.map((testCase) => testCase.workId),
    signal
});
const result = await engine.execute(collected, { ...executionOptions, signal });
```

The preparation owns compiler sessions and releases them through engine cleanup.
Coverage, runtime resources, retries, and runtime assertion operations are unsupported.

## Original-source checking

Relations read types from the original compiler project. Checking creates no
replacement inputs, derived configurations, or emitted outputs. Imports,
contextual typing, and nominal declaration identity remain compiler-owned.

Generic bodies retain their authored constraints. Table rows share their body's
static parameter type. Unsupported evidence remains inconclusive under negation.
Compiler diagnostics invalidate relation evidence rather than becoming assertion
failures. Dedicated deadline and watch behavior remain separate lifecycle work.

Equality returns inconclusive evidence when recursive expansion exceeds 256
comparison levels.
