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
                    reject(new Error('Linearizability package consumer failed.', { cause: error }));
                }
            }
        );
    });
}
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const script = `
import { checkLinearizability } from '@overkill-dev/linearizability';
const model = {initial: () => 0, transition: (state, observation) =>
    observation.outcome.value === state ? {kind: 'enabled', state} : {kind: 'disabled'}};
for (const value of [0, 1]) {
    const result = await checkLinearizability({model, maxWork: 100, signal: new AbortController().signal,
        history: [{kind: 'invoke', id: 'read', operation: null},
        {kind: 'respond', id: 'read', outcome: {kind: 'returned', value}}]});
    if (result.kind !== (value === 0 ? 'linearizable' : 'not-linearizable')) throw new Error(JSON.stringify(result));
}
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
