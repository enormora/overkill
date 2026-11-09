import { runIfMain } from '#test-runner';
import { normalizeConfig } from '../config/config.ts';
import { createDeterministicRunCoordinator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { createEngine, type TestPlan } from '../packages/engine/engine.entry-point.ts';
import {
    planTestSelection,
    parseRunSelection,
    type TestPlanSelectionOptions
} from '../packages/run/run.entry-point.ts';

function discoveredPlan(): TestPlan {
    const engine = createEngine();
    return engine.createTestPlan(engine.createRoot({
        title: 'selection',
        annotations: {},
        controls: {},
        children: [ 'first', 'second', 'third' ].map(function authoredCase(title) {
            return engine.createTestCase({
                title,
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                body() {
                    throw new Error('Planning must not invoke bodies.');
                }
            });
        })
    }));
}

const options: TestPlanSelectionOptions = {
    selection: { kind: 'all' },
    order: 'seeded',
    seed: { value: 42n },
    shard: { index: 1, total: 1 }
};
export const testNode = suite('exact test plan selection', [
    test('partitions selected work without overlap or lost discovery', async function (scope) {
        const plan = discoveredPlan();
        const observed: string[] = [];
        for (const index of [ 1, 2, 3, 4, 5 ]) {
            const selected = await planTestSelection(plan, {
                ...options,
                selection: {
                    kind: 'filter',
                    filter: {
                        kind: 'not',
                        filter: {
                            kind: 'equals',
                            field: 'title',
                            value: 'second'
                        }
                    }
                },
                shard: { index, total: 5 }
            });
            if (selected.kind === 'selected') {
                scope.assert.equal(selected.testPlan.discoveredCases.length, 3);
                observed.push(...selected.testPlan.cases.map(function (entry) {
                    return entry.id.title;
                }));
            } else {
                scope.assert.deepEqual(
                    [ selected.result.status, selected.result.summary.planned, selected.result.summary.discovered ],
                    [ 'passed', 0, 3 ]
                );
            }
        }
        scope.assert.deepEqual(
            observed.toSorted(function alphabetical(left, right) {
                return left.localeCompare(right);
            }),
            [ 'first', 'third' ]
        );
        return scope.assert.collect();
    }),
    test('rejects nested selection and unresolved seeded order', async function (scope) {
        scope.assert.throws(function () {
            return parseRunSelection({ kind: 'all', assertion: 1 });
        }, { message: /Unrecognized key/u });
        await scope.assert.rejects(async function () {
            return planTestSelection(discoveredPlan(), { ...options, seed: { value: null } });
        }, { message: /resolved run seed/u });
        return scope.assert.collect();
    }),
    test('rejects nested selection before configured collection', async function (scope) {
        const coordinator = createDeterministicRunCoordinator();
        const selection = { kind: 'all' as const, assertion: 1 };
        await scope.assert.rejects(async function () {
            return coordinator.orchestrator.resolve({
                config: normalizeConfig({}),
                cwd: '/project',
                engine: { kind: 'default' },
                request: defaultRunRequest({ selection })
            });
        }, { message: /Unrecognized key/u });
        return scope.assert.collect();
    }),
    test('reproduces seeded plan order', async function (scope) {
        const plan = discoveredPlan();
        const first = await planTestSelection(plan, options);
        const second = await planTestSelection(plan, options);
        scope.assert.deepEqual(first, second);
        if (first.kind !== 'selected') {
            throw new Error('Expected a selected plan.');
        }
        scope.assert.deepEqual(
            first.testPlan.cases.map(function caseTitle(entry) {
                return entry.id.title;
            }),
            [ 'first', 'third', 'second' ]
        );
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
