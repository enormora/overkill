# `@overkill-dev/test`

Standard user-facing Overkill distribution.

This package ships the public `overkill` binary and the staged root authoring
facade. The binary parses the minimal command surface and delegates
execution to `@overkill-dev/run/command-line`.

Current root runtime exports:

- `test`
- `suite`
- `table`
- `defineMacro`
- `createTestFacade`
- `runIfMain`

Implemented root authoring forms:

```ts
import { suite, test } from '@overkill-dev/test';

export const testNode = suite('users', [
    test('loads user', (scope) => {
        scope.assert.equal(loadUser('42').name, 'Ada');
        return scope.assert.collect();
    })
]);
```

Nodes created through this root facade default to `metadata.kind: 'microtest'`
unless the object form supplies another `kind`.

Use the object form when attaching node metadata:

```ts
export const testNode = suite({
    name: 'users',
    metadata: { tags: [ 'auth' ] },
    children: [
        test({
            name: 'loads user',
            metadata: { tags: [ 'critical' ] },
            body(scope) {
                scope.assert.equal(loadUser('42').name, 'Ada');
                return scope.assert.collect();
            }
        })
    ]
});
```

`table`, `defineMacro`, `createTestFacade`, and `runIfMain` still throw
explicit unavailable errors.

Supported command-line surface:

- `overkill run [paths...]`
- `overkill list [paths...]`
- `--config <path>`
- `--file <path>`
- `--filter <expr>`
- `--name <text>`
- `--profile <name>`
- `--measure-resource-usage`
- `--resource-budget <name=value>`
- `--with-locations`
- `--with-orphans`

`--resource-budget` accepts `activeResourceCount`,
`javaScriptEngineHeapBytes`, `residentSetBytes`, and
`residentSetGrowthBytesPerSecond`. Supplying a resource budget enables
resource usage measurement for that run.

`--filter`, `--name`, and `--file` apply the same run selection to `run` and
`list`. `--filter` supports `=`, `~`, `:`, `!`, `|`, and parentheses over
`tag`, `runtime`, `owner`, `stability`, `file`, `name`, `suite`, and `params`.

When no paths are supplied, `run` and `list` discover files from the selected
profile's `files.include` and `files.exclude` policy. Explicit file paths run
directly. Directory paths filter the selected profile's discovered files and
require that profile policy.

Standard subpaths are later milestones.
