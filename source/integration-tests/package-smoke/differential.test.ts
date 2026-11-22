import { execFile } from 'node:child_process';
import { suite } from '@overkill-dev/test';
import { consumerEnvironment } from './support/consumer-environment.ts';
import { packageConsumer } from './support/package-consumer.ts';

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
let later = 0;
const control = property({ title: 'packed control', generator: gen.constant(1),
    async test(value, sample) {
        return await differential({ implementations: [
            { name: 'stop', run() { return sample.inconclusive('expected stop'); } },
            { name: 'later', run(input) { later += 1; return input; } }
        ], check(_observations, trial) { later += 1; return trial.assert.collect(); } })(value, sample);
    }
});
const plan = createTestPlan(createRoot({
    title: 'consumer', annotations: {}, controls: {}, children: [node, control]
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
if (result.summary.passed !== 1 || result.summary.inconclusive !== 1 || later !== 0) {
    throw new Error(JSON.stringify(result));
}
console.log('differential package loaded');
`;

const consumerFacade = packageConsumer('packaged differential authoring', function consumerFixture(consumerDirectory) {
    async function execute(source: string): Promise<string> {
        return new Promise(function executeConsumer(resolve, reject) {
            execFile(
                process.execPath,
                [ '--input-type=module', '--eval', source ],
                { env: consumerEnvironment(consumerDirectory), cwd: consumerDirectory },
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
    return { execute };
});
const { test } = consumerFacade;

export const testNode = suite('packaged differential authoring', [
    test('shares property generators across package copies', async function (scope) {
        const { execute } = scope.resources.consumer;

        const result = await execute(script);
        scope.assert.equal(result.trim(), 'differential package loaded');
        return scope.assert.collect();
    })
]);
