import { createClock } from '@enormora/clock';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { benchmarkHostSnapshotSchema } from '../../bench/benchmark-host-snapshot.ts';
import { collectBenchmarkHost } from '../../run/benchmark-host.ts';
import { collectPlatformPressure } from '../../run/benchmark-host-platform.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { runIfMain } from '../direct-launcher.test.ts';

export const testNode = suite('benchmark host observer integration', [
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

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
