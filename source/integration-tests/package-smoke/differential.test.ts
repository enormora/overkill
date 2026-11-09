import { execFile } from 'node:child_process';
import { createSuite, createTestCase } from '@overkill-dev/engine';
import { runIfMain } from '#test-runner';

async function execute(script: string): Promise<string> {
    return new Promise(function executeConsumer(resolve, reject) {
        execFile(
            process.execPath,
            [ '--input-type=module', '--eval', script ],
            { cwd: import.meta.dirname },
            function completed(error, stdout) {
                if (error === null) {
                    resolve(stdout);
                } else {
                    reject(new Error('Differential package consumer failed.', { cause: error }));
                }
            }
        );
    });
}
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const script = `
import { differential } from '@overkill-dev/differential';
import { gen, property } from '@overkill-dev/property';
import { createRoot, createTestPlan, execute } from '@overkill-dev/engine';
const node = property({ title: 'packed differential', generator: gen.constant(1),
    test: differential({ implementations: [
        { name: 'one', run: value => value },
        { name: 'two', run: async value => value }
    ], check(observations, sample) {
        sample.assert.deepEqual(observations[0].outcome, observations[1].outcome);
        return sample.assert.collect();
    } }) });
if (node.title !== 'packed differential') throw new Error('Invalid property node');
const plan = createTestPlan(createRoot({
    title: 'consumer', annotations: {}, controls: {}, children: [node]
}));
const policy = {
    version: 1, newTrials: 2, maxSize: 10, maxDepth: 2, maxAutomaticEdges: 0,
    maxExhaustiveValues: 0, maxWork: 1000, maxShrinkWork: 0, maxLabels: 10, maxRetainedInputs: 10
};
const resolveCases = cases => cases.map(selected => ({
    ...selected, execution: {...selected.execution, policy: {kind: 'resolved', policy}}
}));
const result = await execute({...plan,
    cases: resolveCases(plan.cases), discoveredCases: resolveCases(plan.discoveredCases)
});
if (result.summary.passed !== 1) throw new Error(JSON.stringify(result));
console.log('differential package loaded');
`;

export const testNode = createSuite({
    ...metadata,
    title: 'packaged differential authoring',
    children: [ createTestCase({
        ...metadata,
        title: 'shares property generators across package copies',
        async body(scope) {
            const result = await execute(script);
            scope.assert.equal(result.trim(), 'differential package loaded');
            return scope.assert.collect();
        }
    }) ]
});

await runIfMain(import.meta, testNode);
