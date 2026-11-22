import { execFile } from 'node:child_process';
import { suite } from '@overkill-dev/test';
import { consumerEnvironment } from './support/consumer-environment.ts';
import { packageConsumer } from './support/package-consumer.ts';

const script = `
import { checkLinearizability, linearizability } from '@overkill-dev/linearizability';
if (typeof linearizability !== 'function') throw new Error('Missing concurrent helper export.');
const model = {initial: () => 0, transition: (state, observation) =>
    observation.outcome.value === state ? {kind: 'enabled', state} : {kind: 'disabled'}};
for (const value of [0, 1]) {
    const result = await checkLinearizability({model, maxWork: 100, signal: new AbortController().signal,
        history: [{kind: 'invoke', id: 'read', operation: null},
        {kind: 'respond', id: 'read', outcome: {kind: 'returned', value}}]});
    if (result.kind !== (value === 0 ? 'linearizable' : 'not-linearizable')) throw new Error(JSON.stringify(result));
}
const exhausted = await checkLinearizability({model, maxWork: 1, signal: new AbortController().signal,
    history: [{kind: 'invoke', id: 'read', operation: null},
        {kind: 'respond', id: 'read', outcome: {kind: 'returned', value: 0}}]});
if (exhausted.kind !== 'inconclusive') throw new Error('Checker exhaustion became a verdict.');
import { gen, property } from '@overkill-dev/property';
import { createRoot, createTestPlan, execute as executePlan } from '@overkill-dev/engine';
const node = property({ title: 'packed lanes', generator: gen.tuple(gen.tuple(gen.constant(0))),
    test: linearizability({ create: () => null, run: value => value, model, maxWork: 100 }) });
const limited = property({ title: 'packed inconclusive', generator: gen.tuple(gen.tuple(gen.constant(0))),
    test: linearizability({ create: () => null, run: value => value, model, maxWork: 1 }) });
const plan = createTestPlan(createRoot({
    title: 'consumer', annotations: {}, controls: {}, children: [node, limited]
}));
const policy = {
    version: 1, newTrials: 2, maxSize: 10, maxDepth: 2, maxAutomaticEdges: 0,
    maxExhaustiveValues: 0, maxWork: 1000, maxShrinkWork: 100, maxLabels: 10, maxRetainedInputs: 10
};
const resolveCases = cases => cases.map(selected => ({
    ...selected, execution: {...selected.execution, policy: {kind: 'resolved', policy}}
}));
const executed = await executePlan({...plan,
    cases: resolveCases(plan.cases), discoveredCases: resolveCases(plan.discoveredCases)
});
if (executed.summary.passed !== 1 || executed.summary.inconclusive !== 1) throw new Error(JSON.stringify(executed));
const failing = property({title: 'packed witness',
    generator: gen.constant(null).map(() => { throw new Error('unexpected generation'); }),
    examples: [() => [[0], [1]]],
    test: linearizability({create: () => null, run: () => 1, model, maxWork: 100})});
const failingPlan = createTestPlan(createRoot({
    title: 'witness consumer', annotations: {}, controls: {}, children: [failing]
}));
const readyPlan = {...failingPlan, cases: resolveCases(failingPlan.cases),
    discoveredCases: resolveCases(failingPlan.discoveredCases)};
const captured = await executePlan(readyPlan);
const replay = captured.perTest[0]?.property?.invocations[0]?.confirmedWitness;
if (!replay) throw new Error('Missing confirmed lane witness.');
const repeated = await executePlan(readyPlan, {
    debug: {mode: 'off'}, retryPolicy: null, execution: {mode: 'serial-in-process'},
    reporters: [], runFacts: {}, startedAt: '2026-11-16T00:00:00.000Z', propertyRun: {
    seed: 42n, projectRoot: process.cwd(), replay, corpus: {checkedIn: [], localCache: [], diagnostics: []}
}});
if (repeated.summary.failed !== 1 || JSON.stringify(repeated).includes('unexpected generation'))
    throw new Error('Lane replay failed.');
console.log('linearizability package loaded');
`;

const consumerFacade = packageConsumer(
    'packaged linearizability authoring',
    function consumerFixture(consumerDirectory) {
        async function execute(source: string): Promise<string> {
            return new Promise(function executeConsumer(resolve, reject) {
                execFile(
                    process.execPath,
                    [ '--input-type=module', '--eval', source ],
                    { env: consumerEnvironment(consumerDirectory), cwd: consumerDirectory },
                    function completed(error, stdout, stderr) {
                        if (error === null) {
                            resolve(stdout);
                        } else {
                            reject(new Error(`Linearizability package consumer failed: ${stderr}`, { cause: error }));
                        }
                    }
                );
            });
        }
        return { execute };
    }
);
const { test } = consumerFacade;

export const testNode = suite('packaged linearizability authoring', [
    test('checks histories through the installed package', async function (scope) {
        const { execute } = scope.resources.consumer;

        const result = await execute(script);
        scope.assert.equal(result.trim(), 'linearizability package loaded');
        return scope.assert.collect();
    })
]);
