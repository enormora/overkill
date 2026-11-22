import { execFile } from 'node:child_process';
import { suite } from '@overkill-dev/test';
import { consumerEnvironment } from './support/consumer-environment.ts';
import { packageConsumer } from './support/package-consumer.ts';

const script = `
import { model, modelScenario } from '@overkill-dev/model';
import { gen, sampleGenerator } from '@overkill-dev/property';
const scenario = {
    initial: () => 0,
    commands: () => gen.integer({ min: 1, max: 2 }),
    transition: (state, operation) => ({ kind: 'enabled', state: state + operation }),
    length: { minLength: 1, maxLength: 2 }, codec: null, examples: [], coverage: [],
    create: () => ({ value: 0 }),
    run(operation, system) { system.value += operation; },
    check(state, system, sample) { sample.assert.equal(system.value, state); }
};
const node = model({ ...scenario, title: 'packaged model', settings: {} });
const invocation = modelScenario(scenario);
const inputs = sampleGenerator(invocation.generator, { seed: 42n, count: 2, size: 2, depth: 2 });
if (inputs.length !== 2 || inputs.some(trace => trace.length < 1)) throw new Error('Invalid traces');
if (node.title !== 'packaged model') throw new Error('Invalid model node');
console.log('model package loaded');
`;

const consumerFacade = packageConsumer('packaged model authoring', function consumerFixture(consumerDirectory) {
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
                        reject(new Error('Model package consumer failed.', { cause: error }));
                    }
                }
            );
        });
    }
    return { execute };
});
const { test } = consumerFacade;

export const testNode = suite('packaged model authoring', [
    test('shares property generators across package copies', async function (scope) {
        const { execute } = scope.resources.consumer;

        const result = await execute(script);
        scope.assert.equal(result.trim(), 'model package loaded');
        return scope.assert.collect();
    })
]);
