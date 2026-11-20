import { type TestNode, table, type TestScope, suite, test } from '@overkill-dev/test';

import { createClock } from '@enormora/clock';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import { normalizeConfig } from '../config/config.ts';

import { runResultFactory } from '../test-support/run-result-factory.ts';
import { calibrationSnapshot } from '../test-support/calibration-fixture.ts';
import { defaultRunRequest, defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import { CalibrationPublicationError } from '../baselines/calibration-store.ts';
import { readCalibrationReferenceReport } from '../bench/calibration-report.ts';
import { calibrationMaintenanceSession, type MaintenanceInput } from './calibration-maintenance.ts';

const successful = runResultFactory.build({ status: 'passed', summary: { planned: 0 } });
const snapshot = calibrationSnapshot([ 100, 100 ]);
const reference = {
    version: 1 as const,
    profile: 'bench',
    snapshot,
    owners: [ {
        familyVariant: null,
        case: { file: 'old.bench.ts', suite: [], title: 'old', params: null },
        workload: null,
        runtimes: []
    } ]
};
function unexpectedOperation(): never {
    throw new Error('Unexpected maintenance operation.');
}
function maintenance(remove: MaintenanceInput['store']['remove']): MaintenanceInput {
    const wallClock = createClock();
    const config = normalizeConfig({
        profiles: { bench: { testFamily: 'benchmark', files: { include: [ '*.bench.ts' ] } } }
    });
    const profile = config.profiles.bench;
    if (profile === undefined) {
        throw new Error('Missing benchmark profile.');
    }
    return {
        input: {
            benchmarkPurpose: 'compare',
            benchmarkHost: null,
            benchmarkCalibration: null,
            benchmarkNormalization: {
                mode: 'compare',
                executionId: null,
                profile: 'bench',
                machine: { machineClass: snapshot.machineClass, metadata: {} },
                references: [],
                saved: []
            },
            config,
            profile,
            engine: { kind: 'default' },
            projectRoot: process.cwd(),
            files: [ { file: 'old.bench.ts', fileSet: null, href: 'file:///old.bench.ts', path: '/old.bench.ts' } ],
            request: defaultRunRequest({ profile: 'bench', selection: { kind: 'all' }, baselineUpdateMode: 'apply' })
        },
        references: [ reference ],
        store: {
            list: unexpectedOperation,
            write: unexpectedOperation,
            remove,
            pathOf() {
                return 'calibration/old.json';
            }
        },
        baseline: null,
        dependencies: {
            wallClock,
            reporterDispatcher: createReporterDispatcher({
                wallClock,
                stdout: { writeLine: unexpectedOperation },
                stderr: { writeLine: unexpectedOperation }
            })
        }
    };
}
export const testNode: TestNode = suite('calibration maintenance failures', [
    table({
        title: 'retains maintenance reports across modes',
        cases: [ 'apply', 'diff', 'none' ] as const,
        caseTitle(mode) {
            return `${mode}`;
        },
        async test(scope) {
            const require: typeof scope.require = scope.require;

            const mode = scope.parameters;

            const original = maintenance(async function () {
                return [ 'calibration/old.json' ];
            });
            const session = calibrationMaintenanceSession({
                ...original,
                input: { ...original.input, request: { ...original.input.request, baselineUpdateMode: mode } }
            });
            require.defined(session);
            const result = await session.finalize(successful);
            const report = readCalibrationReferenceReport(result);
            require.defined(report);
            scope.assert.equal(report.outcome, mode === 'apply' ? 'written' : 'read-only');
            scope.assert.equal(result.status, mode === 'none' ? 'failed' : 'passed');
            return scope.assert.collect();
        }
    }),
    test(
        'delegates result preparation and finalization to the baseline session',
        async function (scope: TestScope) {
            const calls: string[] = [];
            const original = maintenance(unexpectedOperation);
            const failed = runResultFactory.build({ status: 'failed' });
            const baseline: NonNullable<MaintenanceInput['baseline']> = {
                reporterDispatcher: original.dependencies.reporterDispatcher,
                prepareResult(result) {
                    calls.push('prepare');
                    return result;
                },
                async finalize() {
                    calls.push('finalize');
                    return failed;
                }
            };
            const session = calibrationMaintenanceSession({ ...original, baseline });
            scope.require.defined(session);
            scope.assert.equal(session.prepareResult(successful), successful);
            scope.assert.deepEqual({ dispatcher: session.reporterDispatcher, result: await session.finalize(failed) }, {
                dispatcher: baseline.reporterDispatcher,
                result: failed
            });
            scope.assert.deepEqual(calls, [ 'prepare', 'finalize' ]);
            return scope.assert.collect();
        }
    ),
    table({
        title: 'skips maintenance for incomplete inventory',
        cases: [ { paths: [ 'selected.bench.ts' ] }, { selection: { kind: 'none' as const } } ],
        caseTitle(request) {
            return `skips maintenance for incomplete inventory ${JSON.stringify(request)}`;
        },
        test(scope) {
            const request = scope.parameters;

            const original = maintenance(unexpectedOperation);
            scope.assert.equal(
                calibrationMaintenanceSession({
                    ...original,
                    input: {
                        ...original.input,
                        request: {
                            ...original
                                .input
                                .request,
                            ...request
                        }
                    }
                }),
                null
            );
            return scope.assert.collect();
        }
    }),
    test('returns the baseline when no references exist', function (scope) {
        scope.assert.equal(
            calibrationMaintenanceSession({ ...maintenance(unexpectedOperation), references: [] }),
            null
        );
        return scope.assert.collect();
    }),
    test('prepares results without a baseline', function (scope: TestScope) {
        const session = calibrationMaintenanceSession(maintenance(unexpectedOperation));
        scope.require.defined(session);
        scope.assert.equal(session.prepareResult(successful), successful);
        return scope.assert.collect();
    }),
    test('preserves references outside the selected shard', function (scope) {
        const original = maintenance(unexpectedOperation);
        const input = { ...original.input, request: { ...original.input.request, shard: { index: 1, total: 2 } } };
        scope.assert.equal(calibrationMaintenanceSession({ ...original, input }), null);
        return scope.assert.collect();
    }),
    test('reports invalid profile types without deleting references', async function (scope: TestScope) {
        const original = maintenance(unexpectedOperation);
        const session = calibrationMaintenanceSession({
            ...original,
            input: { ...original.input, profile: defaultMicrotestProfile() }
        });
        scope.require.defined(session);
        const result = await session.finalize(successful);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(readCalibrationReferenceReport(result), null);
        return scope.assert.collect();
    }),
    test('preserves references owned by skipped cases', async function (scope: TestScope) {
        const owner = reference.owners[0];
        scope.require.defined(owner);
        const session = calibrationMaintenanceSession(maintenance(unexpectedOperation));
        scope.require.defined(session);
        const skipped = runResultFactory.build({
            status: 'passed',
            summary: { planned: 1, skipped: 1 },
            perTest: [ { id: owner.case, verdict: 'skip' } ]
        });
        scope.assert.equal(await session.finalize(skipped), skipped);
        return scope.assert.collect();
    }),
    table({
        title: 'reports maintenance failures with completed removals',
        cases: [
            { name: 'ordinary removal failures', error: new Error('Reference changed'), completed: [] },
            {
                name: 'partial removal failures',
                error: new CalibrationPublicationError('Removal interrupted', {
                    cause: new Error('offline'),
                    completed: [ 'calibration/first.json' ]
                }),
                completed: [ 'calibration/first.json' ]
            }
        ],
        caseTitle(input) {
            return `${input.name}`;
        },
        async test(scope) {
            const require: typeof scope.require = scope.require;

            const input = scope.parameters;

            const session = calibrationMaintenanceSession(maintenance(async function () {
                throw input.error;
            }));
            require.defined(session);
            const result = await session.finalize(successful);
            const report = readCalibrationReferenceReport(result);
            require.defined(report);
            scope.assert.equal(result.status, 'failed');
            scope.assert.deepEqual({ outcome: report.outcome, completed: report.completed }, {
                outcome: 'failed',
                completed: input.completed
            });
            scope.assert.true(result.runnerErrors.some(function (error) {
                return error.subtype === 'artifact';
            }));
            return scope.assert.collect();
        }
    }),
    test(
        'retains errors when even the failure report exceeds the artifact limit',
        async function (scope: TestScope) {
            const original = maintenance(unexpectedOperation);
            const { profile } = original.input;
            if (profile.testFamily !== 'benchmark') {
                throw new Error('Expected benchmark profile.');
            }
            const session = calibrationMaintenanceSession({
                ...original,
                input: {
                    ...original.input,
                    profile: { ...profile, attachments: { ...profile.attachments, maxArtifactBytes: 1 } }
                }
            });
            scope.require.defined(session);
            const result = await session.finalize(successful);
            scope.assert.equal(result.status, 'failed');
            scope.assert.equal(readCalibrationReferenceReport(result), null);
            return scope.assert.collect();
        }
    ),
    test('retains references when the run fails', async function (scope: TestScope) {
        const session = calibrationMaintenanceSession(maintenance(unexpectedOperation));
        scope.require.defined(session);
        const failed = runResultFactory.build({ status: 'failed', summary: { planned: 0 } });
        scope.assert.equal(await session.finalize(failed), failed);
        return scope.assert.collect();
    }),
    test('preserves references when machine attribution is unavailable', async function (scope: TestScope) {
        const original = maintenance(unexpectedOperation);
        const session = calibrationMaintenanceSession({
            ...original,
            input: { ...original.input, benchmarkNormalization: null }
        });
        scope.require.defined(session);
        const result = await session.finalize(successful);
        scope.assert.equal(result.status, 'passed');
        scope.assert.equal(readCalibrationReferenceReport(result), null);
        return scope.assert.collect();
    })
]);
