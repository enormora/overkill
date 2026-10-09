import { appendFile } from 'node:fs/promises';
import { suite, test, skippedTest } from '../../../packages/bench/bench.entry-point.ts';
import { defineResource, defineRuntime, withRuntime } from '../../../packages/test/resources.entry-point.ts';

const lifecycleFile = 'target/benchmark-lifecycle.txt';
const resource = defineResource({
    async acquire({ attachments }) {
        await appendFile(lifecycleFile, 'acquire\n');
        await attachments.json({ mediaType: 'application/json', name: 'setup' }, { ready: true });
        return { value: 42 };
    },
    async dispose(_handle, { attachments }) {
        await appendFile(lifecycleFile, 'dispose\n');
        await attachments.json({ mediaType: 'application/json', name: 'teardown' }, { closed: true });
    },
    name: 'benchmark-resource',
    requirements: [],
    scope: 'per-case'
});

const runtime = defineRuntime({
    dimensions: { kind: 'fixture' },
    name: 'benchmark-runtime',
    requirements: [],
    resources: { fixture: resource }
});

export const testNode = suite('benchmark fixture', [
    test('passes', withRuntime(runtime, async (scope) => {
        await appendFile(lifecycleFile, 'body\n');
        console.log('benchmark output');
        scope.assert.equal(scope.runtimes['benchmark-runtime'].fixture.value, 42);
        return scope.assert.collect();
    })),
    test('fails', (scope) => {
        scope.assert.equal(1, 2);
        return scope.assert.collect();
    }),
    skippedTest('skips', 'unavailable')
]);
