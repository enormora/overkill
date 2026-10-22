import { createDeterministicClock } from '@enormora/clock';
import { createTestCase } from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { createAsyncLeakMonitor } from './async-leak-diagnostics.ts';
import { createReporterDispatcher } from './reporter-dispatcher.ts';
import { createPlainOutputRenderer } from './reporter-output.ts';
import { defineReporter } from './reporter.ts';

export const testNode = createTestCase({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'nested reporter callbacks do not leave test-owned watchdog promises',
    async body(scope) {
        const engine = createTestEngine();
        const [ testCase ] = engine
            .createTestPlan(engine.createRoot({
                annotations: {},
                controls: {},
                title: 'reporter',
                children: [ engine.createTestCase({
                    annotations: {},
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' } ],
                    title: 'callback',
                    body(innerScope) {
                        return innerScope.assert.collect();
                    }
                }) ]
            }))
            .cases;
        const monitor = createAsyncLeakMonitor();
        scope.cleanup(monitor.stop);
        const dispatcher = createReporterDispatcher({
            wallClock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n }),
            stderr: {
                writeLine() {
                    return undefined;
                }
            },
            stdout: {
                writeLine() {
                    return undefined;
                }
            }
        });
        const delivery = await dispatcher.createDelivery([ defineReporter(function () {
            return {
                dispose: null,
                kind: 'real-time',
                name: 'callback',
                sinks: [],
                onFinish: null,
                onEvent() {
                    return undefined;
                }
            };
        }) ], createPlainOutputRenderer());
        await monitor.runCase(testCase, async function reportNestedEvent() {
            await delivery.reportEvent({ kind: 'suite-start', suitePath: [] });
        });
        scope.assert.equal(monitor.casePromiseLeakError(testCase), null);
        return scope.assert.collect();
    }
});

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
