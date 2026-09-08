# `@overkill-dev/test`

Standard user-facing Overkill distribution.

This package ships the public `overkill` binary and the staged root authoring
facade. The binary parses the minimal command surface and delegates
execution to `@overkill-dev/run/command-line`.

Current root runtime exports:

- `test`
- `suite`
- `table`
- `defineHarness`
- `defineMacro`
- `defineParameterizedTestBody`
- `doubleUsage`
- `rule`
- `testDouble`
- `testIterator`
- `testAsyncIterator`
- `testIterable`
- `testAsyncIterable`
- `testDisposable`
- `testAsyncDisposable`
- `createTestFacade`
- `runIfMain`

Standard subpaths:

- `@overkill-dev/test/config` exports `defineConfig` and run project config
  types.
- `@overkill-dev/test/reporters` exports `createLineReporter`,
  `createBriefReporter`, `createDotReporter`, and
  `createGithubActionsOutputRenderer`.
- `@overkill-dev/test/assert` re-exports assertion-extension helpers from
  `@overkill-dev/assert`.
- `@overkill-dev/test/resources` re-exports typed resource and runtime
  descriptors from `@overkill-dev/resources`.
- `@overkill-dev/test/bench` and `@overkill-dev/test/baselines` are reserved.
  They currently export only `unavailable()`.

Implemented root authoring forms:

```ts
import { doubleUsage, suite, table, test, testDouble } from '@overkill-dev/test';

export const testNode = suite('users', [
    test('loads user', (scope) => {
        const loadUser = testDouble.returns({ id: '42', name: 'Ada' });

        scope.assert.equal(loadUser('42').name, 'Ada');
        scope.assert(doubleUsage.calledOnceWith, loadUser, [ '42' ]);
        return scope.assert.collect();
    }),
    table({
        title: 'role access',
        cases: [ 'admin', 'reader' ],
        caseTitle(role) {
            return role;
        },
        test(scope) {
            scope.assert.true(canLoadUser(scope.parameters));
            return scope.assert.collect();
        }
    })
]);
```

The root doubles exports are the current lightweight public surface from
`@overkill-dev/doubles`. Import the leaf package directly when documenting or
testing doubles package ownership.

Nodes created through this root facade derive `metadata.kind: 'microtest'`.
High-level authoring metadata accepts `tags` and `extra`; engine-owned fields
such as `kind`, `runtimes`, and `ownership` stay outside the root facade.

Use the object form when attaching node metadata. Metadata on the exported
top-level `testNode` applies to the whole module's test tree.

```ts
export const testNode = suite({
    title: 'users',
    metadata: { tags: [ 'auth' ] },
    children: [
        test({
            title: 'loads user',
            metadata: { tags: [ 'critical' ] },
            body(scope) {
                scope.assert.equal(loadUser('42').name, 'Ada');
                return scope.assert.collect();
            }
        })
    ]
});
```

`table` expands its `cases` into engine table cases during authoring. The
body receives the original row value as `scope.parameters`; default row titles
are `case 1`, `case 2`, and so on. Reachable tables must contain at least two
rows.

`defineHarness` creates reusable test-side harness constructors:

```ts
const userHarness = defineHarness({
    loadUser: () => testDouble.resolves<() => Promise<User>>(user)
}, (parts) => {
    return {
        subject: createUserService({ loadUser: parts.loadUser }),
        ...parts
    };
});

const harness = userHarness.create();
```

Object-form part factories run fresh for each `create()` call. Sparse
overrides replace final part values; overridden factories are not called.
Function-form harnesses support richer sync or async setup:

```ts
const renderUser = defineHarness(async (overrides: {
    readonly loadUser?: () => Promise<User>;
}) => {
    const loadUser = overrides.loadUser ?? testDouble.resolves<() => Promise<User>>(user);

    return {
        loadUser,
        rendered: await render(<UserPage loadUser={loadUser} />)
    };
});
```

`defineMacro` preserves source locations for reusable test-node factories:

```ts
const checkMissingName = defineMacro((title: string) =>
    test(title, (scope) => {
        scope.assert.equal(buildUser('').name, '', { message: 'missing name' });
        return scope.assert.collect();
    })
);

export const testNode = suite('users', [
    checkMissingName('rejects missing user name')
]);
```

`defineParameterizedTestBody` captures the callsite where data is bound to a
test body:

```ts
const checkName = defineParameterizedTestBody<{ readonly name: string; }>(
    (scope, data) => {
        scope.assert.equal(buildUser(data.name).name, data.name);
        return scope.assert.collect();
    }
);

export const testNode = suite('users', [
    test('builds Ada', checkName({ name: 'Ada' }))
]);
```

`createTestFacade` creates another narrow authoring surface for one test
family:

```ts
import { createTestFacade } from '@overkill-dev/test';

export const {
    defineMacro,
    defineParameterizedTestBody,
    runIfMain,
    suite,
    table,
    test
} = createTestFacade({
    metadata: { tags: [ 'integration' ] },
    testFamily: 'integration'
});
```

The returned facade contains authoring helpers only. Assertions and doubles
are imported alongside it instead of being registered into the facade.

Direct Node execution:

```ts
import { runIfMain, suite, test } from '@overkill-dev/test';

export const testNode = suite('users', [
    test('loads user', (scope) => {
        scope.assert.equal(loadUser('42').name, 'Ada');
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
```

`runIfMain(...)` is a lazy root export. Imported test modules return before
loading runner config or reporters. Entrypoint modules delegate to
`@overkill-dev/run`, load config from `process.cwd()`, select the matching
profile by file policy, and use the default line reporter when no reporter is
configured.

Supported command-line surface:

- `overkill run [paths...]`
- `overkill list [paths...]`
- `--config <path>`
- `--file <path>`
- `--filter <expr>`
- `--title <text>`
- `--profile <name>`
- `--measure-resource-usage`
- `--resource-budget <name=value>`
- `--with-locations`
- `--with-orphans`

`--resource-budget` accepts `activeResourceCount`,
`javaScriptEngineHeapBytes`, `residentSetBytes`, and
`residentSetGrowthBytesPerSecond`. Supplying a resource budget enables
resource usage measurement for that run.

`--filter`, `--title`, and `--file` apply the same run selection to `run` and
`list`. `--filter` supports `=`, `~`, `:`, `!`, `|`, and parentheses over
`tag`, `runtime`, `owner`, `stability`, `file`, `title`, `suite`, and `params`.

When no paths are supplied, `run` and `list` discover files from the selected
profile's `files.include` and `files.exclude` policy. Explicit file paths run
directly. Directory paths filter the selected profile's discovered files and
require that profile policy.
