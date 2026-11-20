import { type TestNode, table, type TestScope, suite } from '@overkill-dev/test';

import type { RunResult } from '../../packages/engine/engine.entry-point.ts';

import { orchestrator } from '../../packages/run/run.entry-point.ts';
import { replayProject, writeReplayCase, replayPropertyUrl } from '../../test-support/replay-project-fixture.ts';

const linearizabilityEntryPoint = new URL(
    '../../packages/linearizability/linearizability.entry-point.ts',
    import.meta.url
);
const linearizabilityUrl = linearizabilityEntryPoint.href;
function assertCooperativeOutcome(scope: TestScope, result: RunResult, reason: string): void {
    scope.assert.equal(result.summary.crashed, 0);
    scope.assert.false(JSON.stringify(result).includes('cleanup before drain'));
    scope.assert.false(JSON.stringify(result).includes('admitted after cancellation'));
    if (reason === 'control') {
        scope.assert.equal(result.summary.inconclusive, 1, { message: JSON.stringify(result) });
    } else if (reason === 'permission') {
        scope.assert.true(result.runnerErrors.some(function permission(error) {
            return error.subtype === 'permission';
        }));
    } else {
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result.perTest), 'timeout');
    }
}

export const testNode: TestNode = suite('linearizability supervision', [
    table({
        title: 'drains cooperative lanes on interruption',
        cases: [ 'cancellation', 'permission', 'control' ],
        caseTitle(reason) {
            return reason;
        },
        async test(scope) {
            const reason = scope.parameters;

            const project = await replayProject(scope, {
                testFamily: 'property',
                files: { include: [ 'case.test.ts' ] },
                execution: { processModel: 'supervised-process', scheduling: 'serial' },
                property: { newTrials: 1, maxAutomaticEdges: 0, maxExhaustiveValues: 0 },
                timeouts: {
                    collectionMilliseconds: 30_000,
                    softMilliseconds: reason === 'cancellation' ? 200 : 5000,
                    hardMilliseconds: 10_000
                }
            });
            await writeReplayCase(
                project,
                `
                import {linearizability} from ${JSON.stringify(linearizabilityUrl)};
                import {gen, property} from ${JSON.stringify(replayPropertyUrl)};
                export const testNode = property({title: 'cooperative lanes',
                    generator: gen.tuple(gen.tuple(gen.constant(1), gen.constant(3)), gen.tuple(gen.constant(2))),
                    test: linearizability({
                        create(sample) {
                            const state = {drained: false, stop: sample.inconclusive};
                            sample.cleanup(() => { if (!state.drained) throw new Error('cleanup before drain'); });
                            return state;
                        },
                        async run(operation, state, signal) {
                            if (operation === 3) throw new Error('admitted after cancellation');
                            if (operation === 2 && '${reason}' !== 'cancellation') {
                                if ('${reason}' === 'control') state.stop('stop lanes');
                                throw Object.assign(new Error('denied operation'), {code: 'ERR_ACCESS_DENIED'});
                            }
                            try {
                                await new Promise((resolve, reject) => {
                                    signal.addEventListener('abort', () => reject(signal.reason), {once: true});
                                });
                            } finally { state.drained = true; }
                        },
                        model: {initial: () => 0, transition: state => ({kind: 'enabled', state})}, maxWork: 100
                    })});
            `
            );
            const result = await orchestrator.run(project.command);
            assertCooperativeOutcome(scope, result, reason);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'supervises unfinished lane operations',
        cases: [ false, true ],
        caseTitle(blocking) {
            return blocking ? 'blocking' : 'unsettled';
        },
        async test(scope) {
            const blocking = scope.parameters;

            const project = await replayProject(scope, {
                testFamily: 'property',
                files: { include: [ 'case.test.ts' ] },
                execution: { processModel: 'supervised-process', scheduling: 'serial' },
                property: { newTrials: 1, maxAutomaticEdges: 0, maxExhaustiveValues: 0 },
                timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 100, hardMilliseconds: 1000 }
            });
            await writeReplayCase(
                project,
                `
                import {linearizability} from ${JSON.stringify(linearizabilityUrl)};
                import {gen, property} from ${JSON.stringify(replayPropertyUrl)};
                export const testNode = property({title: 'uncooperative lane',
                    generator: gen.tuple(gen.tuple(gen.constant(1))),
                    test: linearizability({create: () => null,
                        run() { ${blocking ? 'while (true) {}' : 'return new Promise(() => {});'} },
                        model: {initial: () => 0, transition: state => ({kind: 'enabled', state})},
                        maxWork: 100})});
            `
            );
            const result = await orchestrator.run(project.command);
            scope.assert.equal(result.summary.passed, 0);
            scope.assert.equal(result.summary.inconclusive, 0);
            scope.assert.equal(result.perTest.length, 1);
            scope.assert.equal(result.summary.crashed, 1);
            scope.assert.includes(JSON.stringify(result.runnerErrors), 'hard-timeout');
            return scope.assert.collect();
        }
    })
]);
