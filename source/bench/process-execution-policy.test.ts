import { suite, test } from '@overkill-dev/test';

import { processMeasurement, processMeasurementScenario } from '../test-support/process-measurement.ts';

import { measureProcessCommand } from './process-execution.ts';

export const testNode = suite('process measurement ownership', [
    test('measures command output and releases the child once', async (scope) => {
        const fixture = processMeasurement(processMeasurementScenario);
        const result = await measureProcessCommand(fixture.request, fixture.runtime);
        scope.assert.equal(result.status, 'measured');
        if (result.status === 'measured') {
            scope.assert.deepEqual(result.result.value.completion, { kind: 'exit', code: 0 });
            scope.assert.deepEqual(result.result.metrics.durationMicroseconds, {
                availability: 'available',
                value: 100,
                provenance: { collector: 'process-wall-clock-v1', scope: 'process', unit: 'microseconds' }
            });
            scope.assert.equal(result.cleanupFailure, null);
        }
        scope.assert.deepEqual(fixture.events, [ 'prepare', 'started:42', 'dispose' ]);
        scope.assert.deepEqual(
            fixture.launched.map(function launchContext(launch) {
                return { arguments: launch.arguments, environment: launch.environment };
            }),
            [ { arguments: [ 'argument' ], environment: { UNIT: 'environment' } } ]
        );
        return scope.assert.collect();
    }),
    test('instruments node children and retains final probe evidence', async (scope) => {
        const fixture = processMeasurement(processMeasurementScenario);
        const result = await measureProcessCommand({ ...fixture.request, instrumentation: 'node' }, fixture.runtime);
        scope.assert.equal(result.status, 'measured');
        if (result.status === 'measured') {
            scope.assert.equal(result.result.value.metadata.runtime, 'unit-node');
        }
        scope.assert.deepEqual(fixture.events, [
            'prepare',
            'probe',
            'identified:42',
            'started:42',
            'dispose',
            'final',
            'probe-dispose'
        ]);
        scope.assert.deepEqual(
            fixture.launched.map((launch) => {
                return launch.arguments;
            }),
            [ [ '--unit-probe', 'argument' ] ]
        );
        return scope.assert.collect();
    }),
    test('uses checkpoint evidence for a live ready process', async function (scope) {
        const fixture = processMeasurement({ ...processMeasurementScenario, active: true });
        const request = {
            ...fixture.request,
            instrumentation: 'node' as const,
            request: {
                ...fixture.request.request,
                completion: { kind: 'ready' as const, marker: { stream: 'stdout' as const, text: 'ready' } }
            }
        };
        const result = await measureProcessCommand(request, fixture.runtime);
        scope.assert.equal(result.status, 'measured');
        scope.assert.true(fixture.events.includes('checkpoint'));
        scope.assert.true(fixture.events.includes('probe-dispose'));
        return scope.assert.collect();
    }),
    test('does not initialize launchers for cancelled commands', async function (scope) {
        const fixture = processMeasurement(processMeasurementScenario);
        fixture.controller.abort(new Error('Cancelled command.'));
        const result = await measureProcessCommand(fixture.request, fixture.runtime);
        scope.assert.equal(result.status, 'failed');
        if (result.status === 'failed') {
            scope.assert.equal(result.message, 'Cancelled command.');
        }
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    }),
    test('reports unexpected exit codes and still releases output', async function (scope) {
        const fixture = processMeasurement({ ...processMeasurementScenario, exitCode: 3 });
        const result = await measureProcessCommand(fixture.request, fixture.runtime);
        scope.assert.equal(result.status, 'failed');
        if (result.status === 'failed') {
            scope.assert.includes(result.message, 'code 3');
        }
        scope.assert.true(fixture.events.includes('dispose'));
        return scope.assert.collect();
    }),
    test('retains launch failures and releases an already prepared probe', async function (scope) {
        const fixture = processMeasurement({ ...processMeasurementScenario, launchError: new Error('Launch failed.') });
        const result = await measureProcessCommand({ ...fixture.request, instrumentation: 'node' }, fixture.runtime);
        scope.assert.equal(result.status, 'failed');
        if (result.status === 'failed') {
            scope.assert.equal(result.message, 'Launch failed.');
        }
        scope.assert.deepEqual(fixture.events, [ 'prepare', 'probe', 'probe-dispose' ]);
        return scope.assert.collect();
    }),
    test('reports probe preparation failure without launching children', async function (scope) {
        const fixture = processMeasurement({ ...processMeasurementScenario, probeError: new Error('Probe failed.') });
        const result = await measureProcessCommand({ ...fixture.request, instrumentation: 'node' }, fixture.runtime);
        scope.assert.equal(result.status, 'failed');
        if (result.status === 'failed') {
            scope.assert.equal(result.message, 'Probe failed.');
        }
        scope.assert.deepEqual(fixture.launched, []);
        return scope.assert.collect();
    }),
    test('combines child and probe cleanup failures with a successful measurement', async function (scope) {
        const fixture = processMeasurement({
            ...processMeasurementScenario,
            disposeError: new Error('Child cleanup.'),
            probeDisposeError: new Error('Probe cleanup.')
        });
        const result = await measureProcessCommand({ ...fixture.request, instrumentation: 'node' }, fixture.runtime);
        scope.assert.equal(result.status, 'measured');
        scope.assert.equal(result.cleanupFailure, 'Child cleanup.; Probe cleanup.');
        return scope.assert.collect();
    }),
    test('handles rejected exits and absent child identifiers', async function (scope) {
        const fixture = processMeasurement({
            ...processMeasurementScenario,
            exitError: new Error('Child error.'),
            pid: null
        });
        const result = await measureProcessCommand(fixture.request, fixture.runtime);
        scope.assert.equal(result.status, 'failed');
        if (result.status === 'failed') {
            scope.assert.equal(result.message, 'Child error.');
        }
        scope.assert.deepEqual(fixture.events, [ 'prepare', 'dispose' ]);
        return scope.assert.collect();
    })
]);
