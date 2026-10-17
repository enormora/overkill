import { DryRunStatus } from '@stryker-mutator/api/test-runner';
import { z } from 'zod/v4';
import { suite, test } from '../test/test.entry-point.ts';
import type { CoverageArtifact } from '../engine/engine.entry-point.ts';
import { mutationCoverageFixture } from '../../test-support/mutation-coverage-fixture.ts';
import { dryMutationResult } from './mutation-results.ts';
import { testNode as selectionTestNode } from './mutation-selection.test.ts';
import { testNode as baselineTestNode } from './mutation-baseline.test.ts';
import { mutationLifecycleDataSchema } from './mutation-catalog.ts';

export const testNode = suite('mutation coverage delivery', [
    selectionTestNode,
    baselineTestNode,
    ...([ 'perTest', 'all' ] as const).map(function returnedCoverage(mode) {
        return test(`${mode} returns detached counters without mutating raw evidence`, function (scope) {
            const { reply, baseline } = mutationCoverageFixture(mode);
            const data = mutationLifecycleDataSchema.parse(reply.data);
            const coverage = { ...baseline.coverage, static: { mutant: 4, unloaded: 0 } };
            const result = dryMutationResult('/project', { ...reply, data: { ...data, coverage } }, mode);
            if (result.status !== DryRunStatus.Complete || result.mutantCoverage === undefined) {
                throw new Error('Expected complete coverage results.');
            }
            scope.assert.deepEqual(
                result.mutantCoverage,
                mode === 'all'
                    ? { static: { mutant: 7, unloaded: 0 }, perTest: {} }
                    : structuredClone(coverage)
            );
            coverage.static.mutant = 99;
            scope.assert.equal(result.mutantCoverage.static.mutant, mode === 'all' ? 7 : 4);
            return scope.assert.collect();
        });
    }),
    ...([ 'all', 'off', 'perTest' ] as const).map(function coverageMode(mode) {
        return test(
            `${mode} accepts complete empty counters without requiring coverage for every case`,
            function (scope) {
                const { reply } = mutationCoverageFixture(mode);
                const data = mutationLifecycleDataSchema.parse(reply.data);
                const result = dryMutationResult('/project', {
                    ...reply,
                    data: { ...data, coverage: { static: {}, perTest: {} } }
                }, mode);
                if (result.status !== DryRunStatus.Complete) {
                    throw new Error('Expected a complete dry run with empty counters.');
                }
                scope.assert.equal(result.tests.length, 3);
                scope.assert.equal(Object.hasOwn(result, 'mutantCoverage'), mode !== 'off');
                return scope.assert.collect();
            }
        );
    }),
    test('rejects incomplete results even when selection and completion were shortened together', function (scope) {
        const { reply } = mutationCoverageFixture('perTest');
        const data = mutationLifecycleDataSchema.parse(reply.data);
        const partial = {
            ...reply,
            result: { ...reply.result, perTest: reply.result.perTest.slice(0, 1) },
            data: { ...data, selected: data.selected.slice(0, 1), completed: data.completed.slice(0, 1) }
        };
        scope.assert.equal(dryMutationResult('/project', partial, 'perTest').status, 'error');
        scope.assert.equal(
            dryMutationResult('/project', {
                ...reply,
                result: { ...reply.result, perTest: [] }
            }, 'perTest')
                .status,
            'error'
        );
        return scope.assert.collect();
    }),
    test('rejects unknown owners rather than allowing Stryker to discard their coverage', function (scope) {
        const { reply } = mutationCoverageFixture('perTest');
        const data = mutationLifecycleDataSchema.parse(reply.data);
        const result = dryMutationResult('/project', {
            ...reply,
            data: { ...data, coverage: { static: {}, perTest: { unknown: { mutant: 1 } } } }
        }, 'perTest');
        scope.assert.equal(result.status, 'error');
        return scope.assert.collect();
    }),
    test('does not substitute V8 report data for missing mutant counters', function (scope) {
        const { reply } = mutationCoverageFixture('perTest');
        const data = mutationLifecycleDataSchema.parse(reply.data);
        const artifact: CoverageArtifact = {
            source: 'v8-native',
            id: {
                attempt: null,
                runtimes: [],
                scope: { kind: 'run' },
                sequence: 0,
                subtype: 'coverage',
                workload: null
            },
            payload: {
                completeness: 'complete',
                directory: 'coverage',
                kind: 'coverage',
                rawDataDirectory: 'coverage/raw',
                reports: [],
                summary: {
                    branches: { covered: 0, total: 1 },
                    functions: { covered: 0, total: 1 },
                    lines: { covered: 0, total: 1 }
                }
            }
        };
        Reflect.deleteProperty(data, 'coverage');
        scope.assert.throws(function missingMutantCounters() {
            dryMutationResult('/project', {
                ...reply,
                result: { ...reply.result, artifacts: [ artifact ] },
                data
            }, 'perTest');
        }, { name: 'ZodError' });
        return scope.assert.collect();
    }),
    test('never replaces missing or malformed counter transport with empty coverage', function (scope) {
        const { reply } = mutationCoverageFixture('perTest');
        const data = mutationLifecycleDataSchema.parse(reply.data);
        const missing = { ...data };
        Reflect.deleteProperty(missing, 'coverage');
        const payloads = [
            null,
            missing,
            ...[ null, {}, { static: {} }, { perTest: {} }, { static: { mutant: -1 }, perTest: {} } ]
                .map(function invalidCoverage(coverage) {
                    return { ...data, coverage };
                })
        ];
        for (const payload of payloads) {
            const transported = z.json().parse(payload);
            for (const mode of [ 'all', 'off', 'perTest' ] as const) {
                scope.assert.throws(function readMissingCounters() {
                    dryMutationResult('/project', { ...reply, data: transported }, mode);
                }, { name: 'ZodError' });
            }
        }
        return scope.assert.collect();
    })
]);
