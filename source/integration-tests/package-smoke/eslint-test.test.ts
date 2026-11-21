import { consumerEnvironment } from './support/consumer-environment.ts';
import { execFile } from 'node:child_process';
import { packageConsumer } from './support/package-consumer.ts';

const consumerFacade = packageConsumer(
    'runs packed ESLint examples and generated properties',
    function consumerFixture(consumerDirectory) {
        return { consumerDirectory };
    }
);
const { test } = consumerFacade;

const script = `
import { defineRuleTests, defineConfigTests } from '@overkill-dev/eslint-test';
import { createRoot, createTestPlan, execute } from '@overkill-dev/engine';
const rule = { meta: {schema: []}, create() {return {};} };
const definition = defineRuleTests({name: 'packed rule', rule,
 configs: {first: {}, second: {}}, valid: ['value'], invalid: []});
const root = node => createRoot({title: 'consumer', annotations: {}, controls: {}, children: [node]});
const examples = await execute(createTestPlan(root(definition.examples())));
if (examples.summary.passed !== 2) throw new Error(JSON.stringify(examples));
const plan = createTestPlan(root(definition.properties()));
const policy = {version: 1, newTrials: 2, maxSize: 8, maxDepth: 2, maxAutomaticEdges: 0,
 maxExhaustiveValues: 0, maxWork: 10000, maxShrinkWork: 10, maxLabels: 10, maxRetainedInputs: 10};
const resolve = cases => cases.map(selected => ({...selected,
 execution: {...selected.execution, policy: {kind: 'resolved', policy}}}));
const properties = await execute({...plan, cases: resolve(plan.cases), discoveredCases: resolve(plan.discoveredCases)});
if (properties.summary.passed !== 2) throw new Error(JSON.stringify(properties));
const configs = defineConfigTests({name: 'packed config', configs: {base: [{rules: {'no-debugger': 'error'}}]},
 project: {kind: 'virtual', files: {}, dependencies: {kind: 'none'}}, inventories: [], files: [],
 generation: [{title: 'packed config law', configs: 'all',
 project: {kind: 'virtual', files: {}, dependencies: {kind: 'none'}},
 generator: {kind: 'syntax', syntax: 'javascript', filename: 'file.js'}, contracts: [{kind: 'crash-freedom'}]}],
 fixtures: [{title: 'debugger', configs: 'all', source: {kind: 'inline', filename: 'file.js', code: 'debugger;'},
 expect: {kind: 'lint', diagnostics: {kind: 'rule-ids', rules: 'all', expected: ['no-debugger']}}}]});
const fixtures = await execute(createTestPlan(root(configs.fixtures())));
if (fixtures.summary.passed !== 1) throw new Error(JSON.stringify(fixtures));
const configPlan = createTestPlan(root(configs.properties()));
const configProperties = await execute({...configPlan,
 cases: resolve(configPlan.cases), discoveredCases: resolve(configPlan.discoveredCases)});
if (configProperties.summary.passed !== 1) throw new Error(JSON.stringify(configProperties));
const configExploration = configProperties.perTest[0]?.property?.invocations[0]?.summary.accounting.phases.exploration;
if (configExploration?.executed !== policy.newTrials) throw new Error('Packed config exploration did not complete.');
console.log('ESLint testing package passed');
`;

export const testNode = test('runs packed ESLint examples and generated properties', async function (scope) {
    const { consumerDirectory } = scope.resources.consumer;

    const output = await new Promise<string>(function runConsumer(resolve, reject) {
        execFile(
            process.execPath,
            [ '--input-type=module', '--eval', script ],
            { env: consumerEnvironment(process.env, consumerDirectory), cwd: consumerDirectory },
            function completed(error, stdout, stderr) {
                if (error === null) {
                    resolve(stdout);
                } else {
                    reject(new Error(stderr, { cause: error }));
                }
            }
        );
    });
    scope.assert.equal(output.trim(), 'ESLint testing package passed');
    return scope.assert.collect();
});
