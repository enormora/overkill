# `@overkill-dev/type-test`

Optional native type assertions checked by TSTyche. Install alongside
`@overkill-dev/test`, or use engine roots directly:

```sh
npm install -D @overkill-dev/type-test
```

## Profiles

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@overkill-dev/test/config';
import { family as typeTests } from '@overkill-dev/type-test';

export const config = defineConfig({
    profiles: {
        types: {
            testFamily: typeTests,
            files: { include: [ 'source/**/*.types.ts' ] },
            settings: {
                projectConfigPath: fileURLToPath(new URL('./tsconfig.json', import.meta.url)),
                compiler: { kind: 'local' }
            }
        }
    }
});
```

Run `overkill run --profile types` or `overkill list --profile types`.
Family selection is explicit. A bare `testFamily: 'type-test'` is rejected.
`defineConfig` infers settings independently for each imported family. Imports do
not register commands or change configuration.
The standard distribution does not bundle or re-export this package.
The existing `typeTestProfile(...)` helper on the `/profile` subpath returns the
same imported-family profile. The `typeTestAdapter` export and runner adapter
hooks have been removed.

```ts
import { test } from '@overkill-dev/test';
import { sameType, callableWith } from '@overkill-dev/type-test';

export const testNode = test('preserves inference', (scope) => {
    const result = 'hello' as const;
    scope.assert(sameType<typeof result, 'hello'>());
    scope.assert(callableWith<typeof String>(), 42);
    return scope.assert.collect();
});
```

Case bodies are compiler inputs. Checking never executes their side effects
or invokes runtime assertions. Authored runtime/resource attachments are rejected
before backend preparation. Coverage and ordinary
execution controls are unsupported. Ordinary runtime use of these references
fails clearly; they cannot establish runtime narrowing through `scope.require`.

## Assertion references

| Export                                  | Check                               |
| --------------------------------------- | ----------------------------------- |
| `sameType<Actual, Expected>()`          | Type equality                       |
| `assignableTo<Actual, Expected>()`      | Actual assignable to expected       |
| `assignableFrom<Actual, Expected>()`    | Actual assignable from expected     |
| `acceptsProps<Actual>()`                | JSX component props                 |
| `applicableTo<Actual>()`                | Decorator applicability             |
| `callableWith<Actual>()`                | Function arguments                  |
| `constructableWith<Actual>()`           | Constructor arguments               |
| `instantiableWith<Actual, Arguments>()` | Generic instantiation with a tuple  |
| `hasProperty<Actual>()`                 | Property presence                   |
| `raisesTypeError<Actual>()`             | Pinned TSTyche legacy error matcher |

Every factory has a `.not` counterpart. Relation factories additionally offer
`.withActual<Expected>()`, `.withExpected<Actual>()`, and `.expressions`.
Expression operands pass through `scope.assert(reference, ...operands)`.
Ability factories expose `.withActual` for an expression subject followed by
matcher operands. `instantiableWith.withActual<Arguments>()` takes the type
argument tuple and accepts its subject through `scope.assert`.
The fill-in type `_` is a type-only export.

Decorator applicability takes a declaration callback. TSTyche checks every
`@apply` site as part of that assertion boundary:

```ts
scope.assert(applicableTo<typeof decorate>(), (apply) => {
    @apply
    class Subject {}
});
```

`applicableTo.withActual(decorate)` supplies an expression subject. JSX type
subjects preserve type-only imports and explicit instantiations, such as
`acceptsProps<typeof Component<string>>()`. Expression subjects must use a
component identifier.
Use `.tsx` source files and a project JSX compiler option for JSX checks.
When Node cannot load the authored syntax, precompile with your project tooling
and source maps, then run with `--enable-source-maps`. The adapter reads the
original TypeScript project and never installs require hooks or ESM loaders.

Annotation messages must have a statically known string type.

References must resolve to package exports, including import aliases. Dynamic
reference selection, arbitrary forwarding, and unsupported source forms produce
errors. Native bindings cannot be mixed with runtime assertions in one case.
A selected body without native assertions fails; intentional skipped cases stay
skipped. Missing checker evidence is inconclusive and fails the run.

## Direct engine roots

```ts
import { family as typeTests } from '@overkill-dev/type-test';

const { signal } = new AbortController();
await using prepared = await engine.prepareFamily({
    testPlan: engine.createTestPlan(root),
    testFamily: typeTests,
    settings: { projectConfigPath, compiler: { kind: 'local' } },
    projectRoot: process.cwd(),
    signal
});
const collected = await prepared.collect({
    workIds: prepared.testPlan.cases.map((testCase) => testCase.workId),
    signal
});
const result = await engine.execute(collected, {
    signal,
    debug: { mode: 'off' },
    execution: { mode: 'serial-in-process' },
    retryPolicy: null,
    reporters: [],
    runFacts: {},
    startedAt: new Date().toISOString()
});
```

Use the same engine that constructed the root. Relative settings paths resolve
against the explicit absolute `projectRoot`. Preparations and collections are
single-use; obtain a fresh preparation for another invocation. Backend disposal
finishes before final reporter delivery. The `/check` convenience API retains
runner selection options and delegates to this same engine lifecycle.

Use an in-process profile for this family; compiler deadlines and placement in
other execution hosts remain separate integration work.

Roots may be constructed before
importing the family. The engine and first-party composition APIs preserve
callback provenance without import hooks or source transforms during loading.
Callback lookup supports direct functions and immutable aliases, including
parentheses, type assertions, and `satisfies`. Named options require an
unambiguous callback: potentially overriding spreads, mutation, and escaping
containers are rejected. Low-level table case arrays cannot contain spreads.
Unknown source locations and ambiguous callback origins produce diagnostics.
Copied assertion operands and type arguments retain precise original-source
locations through translation and import repair.

Compiler selection is explicit: `local` uses the compiler resolved by TSTyche;
`version` requires an exact version. Compiler identity belongs to executable
work identity. Generic bodies retain their original constraints and contextual
types. Table rows and reused macro bodies share static evidence; runtime values
do not specialize checking. Selection excludes unselected assertion sites, while
normal TypeScript dependency diagnostics can still fail compilation.

## Generated inputs and lifecycle

Checking uses owned `.overkill-type-test-*` sibling files and explicit derived
project configurations. The derived project maps only the injected `tstyche`
import to this package's installed checker, preserving other compiler settings.
Original files are preserved. Configure project discovery
and external watchers to exclude that prefix. Preparation fails if ordinary
project discovery includes generated files. Cleanup preserves files modified by
other writers and reports failures.

Sibling modules have distinct identity. Direct self-imports and imports between
translated modules are repaired where unambiguous. Transitive nominal references,
package resolution, and source-sensitive constructs can still produce false
passes or failures. This is best-effort checking, not transparent equivalence to
checking the original module. Detected ambiguity is inconclusive. Results retain
original locations and adapter provenance.

Checker calls are serialized within the package. Do not overlap unrelated direct
TSTyche runs in the same process. Dedicated watch support, checker deadlines,
and historical reproduction remain separate integration work.

## Compiler planning

A profile may select several exact compiler versions:

```ts
compiler: {
    kind: 'matrix',
    compilers: [
        { kind: 'local' },
        { kind: 'version', version: '6.0.3' }
    ]
}
```

Planning resolves `local` once and deduplicates equivalent versions. Each
compiler produces distinct executable work while retaining the logical case
identity. A local compiler must also be loadable by its exact version.

Preparation retains the original compiler program, configuration, source
fingerprints, and assertion ownership. Compiler reads include imported
declarations, inherited configuration, and resolution metadata. Frozen facts
are available before execution; generated-input provenance follows in the
result artifact. Facts use lossless JSON rather than assertion serialization.

Detected changes require fresh collection. Inputs are checked before and after
checking; drift invalidates the invocation and stops remaining compilers.
This detects observed filesystem drift without providing an isolated snapshot
or guaranteeing detection of transient changes restored between checks.

Direct checks expand runtime and compiler variants before filtering. Supply a
nonnegative seed for `order: 'seeded'`. Filters precede sharding and ordering;
an empty shard succeeds without invoking the checker. Nested assertion selectors
are unsupported. Result order follows the selected plan; checker traversal may
group shared static evidence independently.
