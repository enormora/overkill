import { suite, test } from '../packages/test/test.entry-point.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultRunConfig, defaultRunRequest, defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import type { RunCommand } from './run-types.ts';
import { supervisedCancellationMessage } from './run-errors.ts';

function command(processModel: 'in-process' | 'supervised-process'): RunCommand {
    return {
        config: defaultRunConfig({
            profiles: { microtest: defaultMicrotestProfile({ execution: { processModel } }) }
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ paths: [ 'missing.test.ts' ] })
    };
}

export const testNode = suite('public cancellation options', [
    test('pre-aborted supervised calls return unattributed infrastructure diagnostics', async function (scope) {
        const controller = new AbortController();
        controller.abort();
        const runner = createDeterministicRunOrchestrator();
        const options = { timing: null, signal: controller.signal };
        const direct = await runner.run(command('supervised-process'), options);
        const delivered = await runner.runWithReporterDelivery(command('supervised-process'), options);
        scope.assert.deepEqual(
            [ direct, delivered.result ].map(function cancellationResult(result) {
                return {
                    status: result.status,
                    executed: result.perTest.length,
                    errors: result.runnerErrors.map(function diagnostic(error) {
                        return { message: error.message, subtype: error.subtype, attribution: error.attributedTo };
                    })
                };
            }),
            [ 0, 1 ].map(function expectedCancellation() {
                return {
                    status: 'failed',
                    executed: 0,
                    errors: [ { message: supervisedCancellationMessage, subtype: 'crash', attribution: null } ]
                };
            })
        );
        return scope.assert.collect();
    }),
    test('malformed cancellation fails before test execution', async function (scope) {
        const options = { timing: null, signal: 'invalid' };
        await scope.assert.rejects(async function invalidSignal() {
            return await createDeterministicRunOrchestrator().run(command('supervised-process'), options);
        }, { message: 'Invocation cancellation requires an AbortSignal.' });
        return scope.assert.collect();
    }),
    test('nonnull cancellation rejects in-process execution and benchmark dispatch', async function (scope) {
        const controller = new AbortController();
        const options = { timing: null, signal: controller.signal };
        const runner = createDeterministicRunOrchestrator();
        await scope.assert.rejects(async function rejectInProcessSignal() {
            return await runner.run(command('in-process'), options);
        }, { message: 'Invocation cancellation requires a supervised-process test profile.' });
        await scope.assert.rejects(async function rejectBenchmarkSignal() {
            return await runner.bench.run(command('supervised-process'), options);
        }, { message: 'Invocation cancellation requires a supervised-process test profile.' });
        return scope.assert.collect();
    }),
    test('a null signal preserves ordinary in-process execution', async function (scope) {
        const result = await createDeterministicRunOrchestrator().run(command('in-process'), {
            timing: null,
            signal: null
        });
        scope.assert.equal(result.status, 'passed');
        return scope.assert.collect();
    })
]);
