import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineReporter } from '../packages/engine/engine.entry-point.ts';
import { normalizeConfig } from '../config/config.ts';
import { createDeterministicRunCoordinator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { analysisFixture, type EvidenceMode } from '../test-support/family-analysis-fixture.ts';
import { selectBenchmarkProfile } from './test-profile.ts';
import type { RunCommand } from './run-types.ts';

function command(record: (event: string) => void, mode: EvidenceMode): RunCommand {
    return {
        config: normalizeConfig({
            profiles: {
                types: {
                    testFamily: analysisFixture(record, mode),
                    settings: null,
                    files: { include: [ 'source/native.types.ts' ] }
                }
            }
        }),
        cwd: '/project',
        engine: { kind: 'default' as const },
        request: defaultRunRequest({ profile: 'types', paths: [ 'source/native.types.ts' ] })
    };
}

export const testNode = suite('family runner failure policy', [
    test('reports imported family identity when rejecting benchmark selection', function (scope) {
        const events: string[] = [];
        const input = command(function record(event) {
            events.push(event);
        }, 'complete');
        scope.assert.throws(function selectAnalysisAsBenchmark() {
            return selectBenchmarkProfile('types', input.config);
        }, {
            message:
                'Profile "types" has testFamily "@example/analysis". Benchmark commands require testFamily "benchmark".'
        });
        scope.assert.deepEqual(events, []);
        return scope.assert.collect();
    }),
    test('maps backend setup failures through runner diagnostics', async function (scope) {
        const events: string[] = [];
        const coordinator = createDeterministicRunCoordinator();
        const result = await coordinator.orchestrator.run(command(function record(event) {
            events.push(event);
        }, 'setup-error'));
        scope.assert.equal(result.status, 'failed');
        scope.assert.includes(
            result
                .runnerErrors
                .map(function (error) {
                    return error.message;
                })
                .join('\n'),
            'Checker setup failed.'
        );
        scope.assert.equal(result.runnerErrors[0]?.subtype, 'loader');
        scope.assert.deepEqual(events, [ 'load', 'prepare' ]);
        return scope.assert.collect();
    }),
    test('disposes empty selections without calling backend collection', async function (scope) {
        const events: string[] = [];
        const coordinator = createDeterministicRunCoordinator();
        const input = command(function record(event) {
            events.push(event);
        }, 'complete');
        const result = await coordinator.orchestrator.run({
            ...input,
            request: { ...input.request, selection: { kind: 'none' } }
        });
        scope.assert.equal(result.summary.planned, 0);
        scope.assert.deepEqual(events, [ 'load', 'prepare', 'dispose' ]);
        return scope.assert.collect();
    }),
    test('retains reporter failure and disposes backend before final delivery', async function (scope) {
        const events: string[] = [];
        const coordinator = createDeterministicRunCoordinator();
        const input = command(function record(event) {
            events.push(event);
        }, 'complete');
        const reporter = defineReporter(function () {
            return {
                kind: 'real-time',
                name: 'failing family reporter',
                sinks: [ { kind: 'memory' } ],
                onFinish: null,
                dispose() {
                    events.push('reporter-dispose');
                },
                onEvent(event) {
                    if (event.kind === 'run-end') {
                        events.push('run-end');
                    } else if (event.kind === 'test-start') {
                        throw new Error('Reporter failed.');
                    }
                }
            };
        });
        const result = await coordinator.orchestrator.run({
            ...input,
            config: { ...input.config, reporters: [ reporter ] }
        });
        scope.assert.equal(result.status, 'failed');
        scope.assert.true(result.runnerErrors.some(function (error) {
            return error.subtype === 'reporter';
        }));
        scope.assert.true(events.indexOf('dispose') < events.indexOf('run-end'));
        scope.assert.equal(
            events
                .filter(function (event) {
                    return event === 'reporter-dispose';
                })
                .length,
            1
        );
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
