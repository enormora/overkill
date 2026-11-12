import { execFile } from 'node:child_process';
import { createTestCase } from '@overkill-dev/engine';
import { runIfMain } from '#test-runner';

const script = `
import { defineRuleTests } from '@overkill-dev/eslint-rule-test';
import { createRoot, createTestPlan, execute } from '@overkill-dev/engine';
const rule = { meta: {schema: []}, create() {return {};} };
const definition = defineRuleTests({name: 'packed rule', rule,
 configs: {first: {}, second: {}}, valid: ['value'], invalid: []});
const root = node => createRoot({title: 'consumer', annotations: {}, controls: {}, children: [node]});
const examples = await execute(createTestPlan(root(definition.examples())));
if (examples.summary.passed !== 2) throw new Error(JSON.stringify(examples));
const plan = createTestPlan(root(definition.properties()));
const policy = {version: 1, newTrials: 2, maxSize: 4, maxDepth: 2, maxAutomaticEdges: 0,
 maxExhaustiveValues: 0, maxWork: 10000, maxShrinkWork: 10, maxLabels: 10, maxRetainedInputs: 10};
const resolve = cases => cases.map(selected => ({...selected,
 execution: {...selected.execution, policy: {kind: 'resolved', policy}}}));
const properties = await execute({...plan, cases: resolve(plan.cases), discoveredCases: resolve(plan.discoveredCases)});
if (properties.summary.passed !== 2) throw new Error(JSON.stringify(properties));
console.log('rule testing package passed');
`;

export const testNode = createTestCase({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'runs packed ESLint examples and generated properties',
    async body(scope) {
        const output = await new Promise<string>(function runConsumer(resolve, reject) {
            execFile(
                process.execPath,
                [ '--input-type=module', '--eval', script ],
                { cwd: import.meta.dirname },
                function completed(error, stdout, stderr) {
                    if (error === null) {
                        resolve(stdout);
                    } else {
                        reject(new Error(stderr, { cause: error }));
                    }
                }
            );
        });
        scope.assert.equal(output.trim(), 'rule testing package passed');
        return scope.assert.collect();
    }
});

await runIfMain(import.meta, testNode);
