import { execFile } from 'node:child_process';
import { createSuite, createTestCase } from '@overkill-dev/engine';
import { runIfMain } from '#test-runner';

async function execute(script: string): Promise<string> {
    return new Promise(function executeConsumer(resolve, reject) {
        execFile(
            process.execPath,
            [ '--input-type=module', '--eval', script ],
            { cwd: import.meta.dirname },
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
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
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
    maxExhaustiveValues: 0, maxWork: 1000, maxShrinkWork: 0, maxLabels: 10, maxRetainedInputs: 10
};
const resolveCases = cases => cases.map(selected => ({
    ...selected, execution: {...selected.execution, policy: {kind: 'resolved', policy}}
}));
const executed = await executePlan({...plan,
    cases: resolveCases(plan.cases), discoveredCases: resolveCases(plan.discoveredCases)
});
if (executed.summary.passed !== 1 || executed.summary.inconclusive !== 1) throw new Error(JSON.stringify(executed));
console.log('linearizability package loaded');
`;

export const testNode = createSuite({
    ...metadata,
    title: 'packaged linearizability authoring',
    children: [ createTestCase({
        ...metadata,
        title: 'checks histories through the installed package',
        async body(scope) {
            const result = await execute(script);
            scope.assert.equal(result.trim(), 'linearizability package loaded');
            return scope.assert.collect();
        }
    }) ]
});

await runIfMain(import.meta, testNode);
