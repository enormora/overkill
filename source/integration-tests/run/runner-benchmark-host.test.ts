import { AsyncLocalStorage } from 'node:async_hooks';
import { ChildProcess } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import { createClock } from '@enormora/clock';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { benchmarkHostSnapshotSchema } from '../../bench/benchmark-host-snapshot.ts';
import { collectBenchmarkHost } from '../../run/benchmark-host.ts';
import { collectPlatformPressure } from '../../run/benchmark-host-platform.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';

export const testNode = suite('benchmark host observer integration', [
    ...[ true, false ].map(function (cancelled) {
        return test(
            cancelled ? 'does not start cancelled probes' : 'awaits cancelled probe closure',
            async function (scope) {
                const probe = {
                    cancellation: new AbortController(),
                    context: new AsyncLocalStorage<boolean>(),
                    children: new Map<ChildProcess, boolean>()
                };
                const signal = cancelled ? AbortSignal.abort() : probe.cancellation.signal;
                const spawned = channel('child_process');
                function observeChild(message: unknown): void {
                    if (probe.context.getStore() !== true || typeof message !== 'object' || message === null) {
                        return;
                    }
                    const child: unknown = Reflect.get(message, 'process');
                    if (!(child instanceof ChildProcess)) {
                        return;
                    }
                    probe.children.set(child, false);
                    child.once('close', function () {
                        probe.children.set(child, true);
                    });
                    queueMicrotask(function () {
                        probe.cancellation.abort();
                    });
                }
                scope.cleanup(function () {
                    spawned.unsubscribe(observeChild);
                    probe.context.disable();
                });
                spawned.subscribe(observeChild);
                await probe.context.run(true, async function () {
                    return await collectPlatformPressure('darwin', signal);
                });
                scope.assert.equal(probe.children.size > 0, !cancelled);
                scope.assert.true(Array.from(probe.children.values()).every(Boolean));
                return scope.assert.collect();
            }
        );
    }),
    test('records no platform-specific pressure on unsupported platforms', async function (scope: TestScope) {
        scope.assert.deepEqual(await collectPlatformPressure('unsupported', AbortSignal.abort()), {});
        return scope.assert.collect();
    }),
    test('records cancelled platform probes as unavailable', async function (scope: TestScope) {
        const linux = await collectPlatformPressure('linux', AbortSignal.abort());
        const darwin = await collectPlatformPressure('darwin', AbortSignal.abort());
        scope.assert.equal(linux['linux.memory.some.avg10']?.availability, 'unavailable');
        scope.assert.equal(darwin.CPU_Speed_Limit?.availability, 'unavailable');
        scope.assert.equal(darwin.darwinMemoryPressureCode?.availability, 'unavailable');
        return scope.assert.collect();
    }),
    test(
        'records real observer provenance and returns valid evidence after a capped window',
        async function (scope: TestScope) {
            const snapshot = await collectBenchmarkHost({ timeoutMilliseconds: 1000 }, createClock());
            scope.assert.equal(benchmarkHostSnapshotSchema.safeParse(snapshot).success, true);
            scope.assert.equal(snapshot.runtime.processId, process.pid);
            scope.assert.equal(snapshot.runtime.nodeVersion, process.versions.node);
            scope.assert.true(snapshot.durationMicroseconds > 0);
            scope.assert.true(Object.keys(snapshot.observer).length > 0);
            const timedOut = await collectBenchmarkHost({ timeoutMilliseconds: 1 }, createClock());
            scope.assert.equal(timedOut.signals.cpuBusyPercent.availability, 'unavailable');
            scope.assert.equal(benchmarkHostSnapshotSchema.safeParse(timedOut).success, true);
            return scope.assert.collect();
        }
    )
]);

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
