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
import { typeTestProfile } from '@overkill-dev/type-test/profile';

export const config = defineConfig({
    profiles: {
        types: typeTestProfile({
            files: { include: [ 'source/**/*.types.ts' ] },
            projectConfigPath: fileURLToPath(new URL('./tsconfig.json', import.meta.url)),
            compiler: { kind: 'local' }
        })
    }
});
```

Run `overkill run --profile types` or `overkill list --profile types`.
Registration is explicit. Imports do not register commands or change configuration.
The standard distribution does not bundle or re-export this package.

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

Case bodies are compiler inputs. Checking never executes their side effects,
acquires resources, or invokes runtime assertions. Coverage and ordinary
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
import { checkTypeTests } from '@overkill-dev/type-test/check';

const result = await checkTypeTests({
    engine,
    root,
    selection: { kind: 'all' },
    projectConfigPath,
    compiler: { kind: 'version', version: '6.0.3' }
});
```

Use the same engine that constructed the root. Roots may be constructed before
importing the adapter. The engine and first-party composition APIs preserve
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
compiler matrices, and historical reproduction remain separate integration work.
