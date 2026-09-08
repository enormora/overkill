# `@overkill-dev/resources`

Typed resource and runtime descriptors for Overkill.

This package defines resources as inert values. A resource declares its stable
name, lifecycle scope, execution requirements, acquisition callback, and
disposal callback. Runners do not execute these descriptors yet.

```ts
import { defineResource, defineRuntime, type RuntimeContext } from '@overkill-dev/resources';

const database = defineResource({
    name: 'database',
    scope: 'per-case',
    requirements: [ { kind: 'exclusive-resource', name: 'database' } ],
    async acquire(context) {
        context.signal.throwIfAborted();

        return await openDatabase();
    },
    async dispose(database, _context) {
        await database.close();
    }
});

const runtime = defineRuntime({
    name: 'api',
    dimensions: {},
    resources: { database },
    requirements: [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 1000 } ]
});

type ApiContext = RuntimeContext<typeof runtime>;
```

`RuntimeContext` uses the keys from the runtime's `resources` object. Resource
`name` remains the stable identity used by reporters, artifacts, and future
scheduling work.
