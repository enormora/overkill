import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';

import { normalizeConfig, type BenchmarkHostSnapshot, type RunCommand } from '../../../packages/run/run.entry-point.ts';
import { benchmarkHostSnapshot } from '../../../test-support/benchmark-host-snapshot.ts';
import { fakeWorkerPoolRuntimeDependencies } from '../../../test-support/worker-pool-runtime-fixtures.ts';
import { defaultRunRequest } from '../../../test-support/run-command-factory.ts';
import { readBenchmarkRunMetadata } from '../../../bench/benchmark-run-report.ts';
import { canonicalIdentityJson, type RunResult } from '../../../packages/engine/engine.entry-point.ts';

import { createRunCoordinator, type RunCoordinator } from '../../../run/run-coordinator.entry-point.ts';

type ReporterNotification = { readonly kind: string; };

function rejectedHost(): BenchmarkHostSnapshot {
    const captured = benchmarkHostSnapshot();
    return {
        ...captured,
        signals: {
            ...captured.signals,
            availableMemoryPercent: {
                source: 'node',
                scope: 'process',
                unit: 'percent',
                availability: 'unavailable',
                reason: 'permission denied'
            }
        }
    };
}

const assertRejectedRun = defineCompositeAssertion({
    name: 'rejected run',
    assert(check, result: RunResult) {
        return check.group([
            check.equal(result.status, 'failed'),
            check.equal(result.summary.planned, 0),
            check.equal(result.runnerErrors[0]?.subtype, 'measurement'),
            check.equal(result.artifacts.length, 0)
        ]);
    }
});

const assertHostEvidence = defineCompositeAssertion({
    name: 'host evidence',
    assert(compare, result: RunResult, snapshot: BenchmarkHostSnapshot) {
        const host = readBenchmarkRunMetadata(result.preparationFacts)?.host;
        if (host === undefined || host === null) {
            return compare.defined(host);
        }
        return compare.group([
            compare.equal(canonicalIdentityJson(host.snapshot), canonicalIdentityJson(snapshot)),
            compare.deepEqual(
                host.checks.map(function status(check) {
                    return check.status;
                }),
                [ 'violated', 'unavailable' ]
            )
        ]);
    }
});

function command(): RunCommand {
    return {
        cwd: '/virtual/project',
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'startup' }),
        config: normalizeConfig({
            profiles: {
                startup: {
                    testFamily: 'benchmark',
                    files: { include: [ 'sample.bench.ts' ] },
                    host: { limits: { maximumCpuBusyPercent: 20, minimumAvailableMemoryPercent: 10 } }
                }
            }
        })
    };
}

function observedHostRunner(
    record: (event: string) => void,
    snapshot: BenchmarkHostSnapshot,
    collection: 'fails' | 'forbidden'
): RunCoordinator {
    const dependencies = fakeWorkerPoolRuntimeDependencies();
    return createRunCoordinator({
        ...dependencies,
        async discoverRunFilesWithProjectRoot() {
            record('discover');
            return {
                projectRoot: '/virtual/project',
                files: [ {
                    file: 'sample.bench.ts',
                    fileSet: null,
                    href: 'file:///virtual/project/sample.bench.ts',
                    path: '/virtual/project/sample.bench.ts'
                } ]
            };
        },
        async collectBenchmarkHost() {
            record('host');
            return snapshot;
        },
        async loadRunTestModules() {
            record('collect');
            throw new Error('Rejected host must not collect modules.');
        },
        createWorkerPool(options) {
            record('worker');
            if (collection === 'forbidden') {
                throw new Error('Rejected host must not create workers.');
            }
            const pool = dependencies.createWorkerPool(options);
            return {
                ...pool,
                async run(task, runOptions) {
                    record('collect');
                    return await pool.run(task, runOptions);
                }
            };
        },
        runtimeStateStore: {
            ...dependencies.runtimeStateStore,
            async write(file, contents) {
                record('write');
                await dependencies.runtimeStateStore.write(file, contents);
            }
        },
        reporterDispatcher: {
            ...dependencies.reporterDispatcher,
            async createDelivery() {
                return {
                    async disposeReporters() {
                        record('dispose');
                        return [];
                    },
                    async reportEvent(event: ReporterNotification) {
                        record(event.kind);
                        return [];
                    },
                    async reportResult() {
                        record('result');
                        return [];
                    }
                };
            }
        }
    });
}

function acceptedCommand(): RunCommand {
    return {
        ...command(),
        config: normalizeConfig({
            profiles: {
                startup: {
                    testFamily: 'benchmark',
                    files: { include: [ 'sample.bench.ts' ] },
                    execution: { processModel: 'worker-pool' },
                    host: { limits: { maximumCpuBusyPercent: 25 } }
                }
            }
        })
    };
}

export const testNode = suite('benchmark host admission', [
    test(
        'reports host observation failure before collection without inventing evidence',
        async function (scope) {
            const dependencies = fakeWorkerPoolRuntimeDependencies();
            const runner = createRunCoordinator({
                ...dependencies,
                async discoverRunFilesWithProjectRoot() {
                    return {
                        projectRoot: '/virtual/project',
                        files: [ {
                            file: 'sample.bench.ts',
                            fileSet: null,
                            href: 'file:///virtual/project/sample.bench.ts',
                            path: '/virtual/project/sample.bench.ts'
                        } ]
                    };
                },
                async collectBenchmarkHost() {
                    throw new Error('Native observer unavailable.');
                }
            });
            const result = await runner.orchestrator.bench.run(command(), { timing: null });
            scope.assert.equal(result.status, 'failed');
            scope.assert.equal(result.summary.planned, 0);
            scope.assert.equal(result.runnerErrors[0]?.subtype, 'measurement');
            scope.assert.equal(result.runnerErrors[0]?.message, 'Native observer unavailable.');
            scope.assert.equal(readBenchmarkRunMetadata(result.preparationFacts)?.host, null);
            return scope.assert.collect();
        }
    ),
    test('retains accepted host evidence when worker collection fails', async function (scope: TestScope) {
        const delivered: string[] = [];
        const snapshot = benchmarkHostSnapshot();
        const runner = observedHostRunner(
            function recordEvent(event) {
                delivered.push(event);
            },
            snapshot,
            'fails'
        );
        const result = await runner.orchestrator.bench.run(acceptedCommand(), { timing: null });
        const host = readBenchmarkRunMetadata(result.preparationFacts)?.host;
        scope.require.defined(host);
        scope.assert.equal(canonicalIdentityJson(host.snapshot), canonicalIdentityJson(snapshot));
        scope.assert.equal(result.runnerErrors[0]?.subtype, 'loader');
        scope.assert.deepEqual(delivered, [
            'discover',
            'write',
            'host',
            'worker',
            'collect',
            'runner-error',
            'run-end',
            'result',
            'dispose',
            'write'
        ]);
        return scope.assert.collect();
    }),
    test(
        'retains rejected checks without collecting or creating workers',
        async function (scope) {
            const delivered: string[] = [];
            const snapshot = rejectedHost();
            const runner = observedHostRunner(
                function recordEvent(event) {
                    delivered.push(event);
                },
                snapshot,
                'forbidden'
            );
            const result = await runner.orchestrator.bench.run(command(), { timing: null });
            scope.assert(assertRejectedRun, result);
            scope.assert(assertHostEvidence, result, snapshot);
            scope.assert.deepEqual(delivered, [
                'discover',
                'write',
                'host',
                'runner-error',
                'run-end',
                'result',
                'dispose',
                'write'
            ]);
            return scope.assert.collect();
        }
    )
]);
