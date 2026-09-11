# `@overkill-dev/test`

Standard user-facing Overkill distribution.

This package ships the public `overkill` binary and the staged root authoring
facade. The binary parses the minimal command surface and delegates
execution to `@overkill-dev/run/command-line`.

Current root runtime exports:

- `test`
- `skippedTest`
- `suite`
- `table`
- `defineHarness`
- `defineMacro`
- `defineParameterizedTestBody`
- `createTranscript`
- `recordSink`
- `recordAsyncSink`
- `transcriptUsage`
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
- `@overkill-dev/test/compatibility` exports `throwingTest` for explicit
  throwable-style test authoring.
- `@overkill-dev/test/resources` re-exports typed resource and runtime
  descriptors from `@overkill-dev/resources`, including
  `createTemporaryDirectoryResource(...)`, and adds `withRuntime(...)` for
  explicit `scope.runtime` composition.
- `@overkill-dev/test/bench` and `@overkill-dev/test/baselines` are reserved.
  They currently export only `unavailable()`.

Implemented root authoring forms:

```ts
import { doubleUsage, skippedTest, suite, table, test, testDouble } from '@overkill-dev/test';

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
    }),
    skippedTest('loads platform user', 'requires linux')
]);
```

The root doubles exports are the current lightweight public surface from
`@overkill-dev/doubles`. Import the leaf package directly when documenting or
testing doubles package ownership.

Nodes created through this root facade are microtests. The engine records that
as internal family data, not as authored test data.

Use the object form when attaching annotations or controls. Annotations on the
exported top-level `testNode` apply to the whole module's test tree.

`skippedTest(title, reason)` creates a visible leaf test with a mandatory
reason. It is discovered, listed, reported as skipped, and never runs user
code. Object form is `skippedTest({ title, annotations, controls, reason })`.

`throwingTest` is available from the compatibility subpath when a test should
pass by completing normally instead of returning `scope.assert.collect()`:

```ts
import { throwingTest } from '@overkill-dev/test/compatibility';

export const testNode = throwingTest('legacy assertion', (scope) => {
    scope.assert.equal(add(2, 3), 5);
});
```

The throwing body receives `scope.assert`, `scope.require`, and `scope.signal`.
It does not expose `scope.plan` or `scope.assert.collect`.

```ts
export const testNode = suite({
    title: 'users',
    annotations: { tags: [ 'auth' ] },
    children: [
        test({
            title: 'loads user',
            annotations: { tags: [ 'critical' ] },
            controls: { timeoutMilliseconds: 1_000 },
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

`createTranscript` records ordered interaction entries as tuple values:

```ts
const transcript = createTranscript<readonly [kind: 'state', value: number]>();

transcript.record('state', 1);

scope.assert(transcriptUsage.exactly, transcript, [
    [ 'state', 1 ]
]);
```

`transcript.sink(kind)` creates a void test double that records each call as
`[kind, ...args]`. The double call history and transcript entries reset
independently.

```ts
const transcript = createTranscript<readonly [kind: 'warn', message: string]>();
const warn = transcript.sink<(message: string) => void>('warn');

warn('retrying');

scope.assert(transcriptUsage.contains, transcript, [ 'warn', 'retrying' ]);
scope.assert(doubleUsage.calledOnceWith, warn, [ 'retrying' ]);
```

`recordSink` and `recordAsyncSink` subscribe immediately and return disposable
transcripts for callback-based sources:

```ts
const states = recordSink<readonly [kind: 'state', value: number]>((record) => {
    return store.subscribe((value) => {
        record('state', value);
    });
});

const events = recordAsyncSink<readonly [kind: 'event', value: Event]>((record) => {
    return queue.listen((value) => {
        record('event', value);
    });
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

Runtime handles stay behind the resources subpath:

```ts
import { createTestFacade } from '@overkill-dev/test';
import {
    createTemporaryDirectoryResource,
    defineResource,
    defineRuntime,
    startRuntime,
    withRuntime
} from '@overkill-dev/test/resources';

const integration = createTestFacade({ testFamily: 'integration' });
const scratch = createTemporaryDirectoryResource('scratch');
const database = defineResource({
    name: 'database',
    scope: 'per-case',
    requirements: [],
    dependencies: {},
    acquire() {
        return openDatabase();
    },
    dispose: null
});

const runtime = defineRuntime({
    name: 'api',
    dimensions: {},
    resources: { database, scratch },
    requirements: []
});
await using session = await startRuntime({ runtime, signal });

integration.test(
    'loads user',
    withRuntime(runtime, session.context, (scope) => {
        scope.assert.true(scope.runtime.scratch.path.length > 0);
        scope.assert.equal(scope.runtime.database.loadUser('42').id, '42');
        return scope.assert.collect();
    })
);
```

Microtest authoring rejects first-party resource and runtime attachments.

Test bodies receive async-control methods on `scope`:

| Method               | Purpose                                                   |
| -------------------- | --------------------------------------------------------- |
| `drainMicrotasks()`  | Wait for already-scheduled Promise and microtask work.    |
| `yieldToNextTurn()`  | Yield through one Node event-loop turn.                   |
| `settleAsyncWork()`  | Run a bounded set of microtask and next-turn checkpoints. |
| `startInFlight(...)` | Start background Promise work now and observe it later.   |
| `cleanup(...)`       | Register sync or async teardown for test-owned resources. |

```ts
test('logs background failures', async (scope) => {
    const run = scope.startInFlight(() => worker.run());

    await scope.yieldToNextTurn();

    await run.rejects({ message: 'boom' });
    scope.assert.equal(logger.error.interactionCount, 1);
    return scope.assert.collect();
});
```

`settleAsyncWork()` is intentionally bounded. Use it for finite queue
cascades, not as proof that all background work is complete. Work started with
`startInFlight(...)` must settle and be observed before the test ends.

`createTestFacade` creates another narrow authoring surface for one test
family:

```ts
import { createTestFacade } from '@overkill-dev/test';

export const {
    defineMacro,
    defineParameterizedTestBody,
    runIfMain,
    skippedTest,
    suite,
    table,
    test
} = createTestFacade({
    annotations: { tags: [ 'integration' ] },
    controls: { capture: 'live' },
    testFamily: 'integration'
});
```

The returned facade contains authoring helpers only. Assertions and doubles
are imported alongside it instead of being registered into the facade.
Non-microtest facades also accept `controls.capture` as a capture preference
for tests, suites, tables, and facade-wide controls.

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
- `--order <seeded|lexical>`
- `--seed <n>`
- `--title <text>`
- `--profile <name>`
- `--no-capture`
- `--measure-resource-usage`
- `--resource-budget <name=value>`
- `--with-locations`
- `--with-orphans`

`--resource-budget` accepts `activeResourceCount`,
`javaScriptEngineHeapBytes`, `residentSetBytes`, and
`residentSetGrowthBytesPerSecond`. Supplying a resource budget enables
resource usage measurement for that run.

`--no-capture` applies to `run` only. It passes stdout and stderr through live
for capture-capable profiles and is invalid for microtest profiles.

`--filter`, `--title`, and `--file` apply the same run selection to `run` and
`list`. `--filter` supports `=`, `~`, `:`, `!`, `|`, and parentheses over
`tag`, `runtime`, `owner`, `stability`, `file`, `title`, `suite`, and `params`.

Runs use seeded ordering by default. Pass `--seed <n>` to reproduce a shuffle,
or `--order lexical` to use deterministic source-stable order. `runIfMain(...)`
also uses seeded order and reports the generated seed through run facts and
first-party reporters.

When no paths are supplied, `run` and `list` discover files from the selected
profile's `files.include` and `files.exclude` policy. Explicit file paths run
directly. Directory paths filter the selected profile's discovered files and
require that profile policy.
