import { type TestNode, table, suite } from '@overkill-dev/test';

import { propertyCorpusEntry } from '../test-support/property-corpus.ts';
import { planningInput } from '../test-support/benchmark-plan-input.ts';
import { defaultIntegrationProfile } from '../test-support/run-command-factory.ts';

import { passingIsolatedWorkerRun } from '../test-support/isolated-worker-run.ts';
import { createCollectedPlan } from '../test-support/worker-pool-execution-state.ts';
import { createResolvedRunFromCollection, type CollectionResolvedRunInput } from './run-collected-resolution.ts';

function collectionInput(empty: boolean): CollectionResolvedRunInput {
    const fixture = passingIsolatedWorkerRun(false, false);
    const profile = defaultIntegrationProfile({ execution: { processModel: 'supervised-process' } });
    const config = { ...fixture.input.config, profiles: { integration: profile } };
    const source = createCollectedPlan();
    const plan = { ...source, discoveredFiles: source.files, files: empty ? [] : source.files };
    return {
        ...fixture.input,
        profile,
        config,
        allowEmptySelection: empty,
        command: { ...fixture.command, config },
        dependencies: fixture.dependencies,
        durationHistoryIndex: null,
        planKind: 'supervised',
        collection: { collectedPlan: plan, runnerErrors: [] }
    };
}
type ReplaySelection = 'empty' | 'multiple' | 'ordinary' | 'skipped';
function witnessSelection(mode: ReplaySelection): CollectionResolvedRunInput {
    const input = collectionInput(false);
    const file = input.collection.collectedPlan.files[0];
    const first = file?.cases[0];
    if (file === undefined || first === undefined) {
        throw new Error('Expected collected case.');
    }
    const casesByMode = {
        empty: [],
        multiple: [ first, { ...first, title: 'second' } ],
        ordinary: [ first ],
        skipped: [ { ...first, skipReason: 'unsupported' } ]
    };
    const cases = casesByMode[mode];
    const files = [ { ...file, cases } ];
    return {
        ...input,
        allowEmptySelection: true,
        command: { ...input.command, propertyReplay: propertyCorpusEntry },
        collection: {
            ...input.collection,
            collectedPlan: { ...input.collection.collectedPlan, files, discoveredFiles: files }
        }
    };
}
function normalizedCollection(purpose: CollectionResolvedRunInput['benchmarkPurpose']): CollectionResolvedRunInput {
    const base = collectionInput(false);
    const planned = planningInput();
    const config = { ...base.config, profiles: { ...base.config.profiles, sizes: planned.profile } };
    const context: CollectionResolvedRunInput['benchmarkNormalization'] = {
        executionId: null,
        mode: purpose,
        profile: 'sizes',
        machine: { machineClass: 'unit', metadata: {} },
        references: [],
        saved: []
    };
    return {
        ...base,
        ...planned,
        benchmarkPurpose: purpose,
        benchmarkNormalization: context,
        config,
        command: { ...base.command, config, request: planned.request },
        collection: { collectedPlan: planned.collectedPlan, runnerErrors: [] }
    };
}
export const testNode: TestNode = suite(
    'collected execution resolution policy',
    [
        table({
            title: 'rejects witness replay with incompatible selection',
            cases: [ 'empty', 'multiple', 'ordinary', 'skipped' ] as const,
            caseTitle(selection) {
                return selection;
            },
            async test(scope) {
                const selection = scope.parameters;

                await scope.assert.rejects(async function () {
                    return createResolvedRunFromCollection(witnessSelection(selection));
                }, { message: /requires exactly one executable property case/u });
                return scope.assert.collect();
            }
        }),
        table({
            title: 'retains normalization context across collection purposes',
            cases: [ 'capture', 'compare' ] as const,
            caseTitle(purpose) {
                return purpose;
            },
            async test(scope) {
                const purpose = scope.parameters;

                const input = normalizedCollection(purpose);
                const run = await createResolvedRunFromCollection(input);
                scope.assert.deepEqual({ normalization: run.facts.benchmarkNormalization }, {
                    normalization: purpose === 'capture' ? input.benchmarkNormalization : null
                });
                scope.assert.equal(run.facts.execution.testFamily, 'benchmark');
                return scope.assert.collect();
            }
        }),
        table({
            title: 'preserves supervised collection facts for empty and populated plans',
            cases: [ false, true ],
            caseTitle: String,
            async test(scope) {
                const empty = scope.parameters;

                const input = collectionInput(empty);
                const run = await createResolvedRunFromCollection(input);
                scope.assert.equal(run.plan.kind, 'supervised');
                scope.assert.equal(run.facts.execution.testFamily, 'integration');
                scope.assert.equal(run.facts.benchmarkNormalization, null);
                scope.assert.equal(Object.isFrozen(run), true);
                scope.assert.deepEqual(run.collectionRunnerErrors, []);
                return scope.assert.collect();
            }
        })
    ]
);
