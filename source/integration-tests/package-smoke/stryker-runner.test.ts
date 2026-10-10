import { execFile } from 'node:child_process';
import { createSuite, createTestCase } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';
import { runIfMain } from './direct-launcher.test.ts';
import { strykerRunnerScript } from './stryker-runner-scripts.test.ts';

type ScriptOutput = {
    readonly stderr: string;
    readonly stdout: string;
};

export const testNode = createSuite({
    annotations: {},
    children: [
        createTestCase({
            annotations: {},
            async body(scope) {
                const result = await new Promise<ScriptOutput>(function executePackagedStrykerRunner(resolve, reject) {
                    execFile(
                        process.execPath,
                        [ '--input-type=module', '--eval', strykerRunnerScript ],
                        { cwd: import.meta.dirname },
                        function collectScriptOutput(error, stdout, stderr) {
                            if (error instanceof Error) {
                                reject(error);
                            } else {
                                resolve({ stderr, stdout });
                            }
                        }
                    );
                });

                scope.assert.equal(result.stdout, 'stryker profile initialization passed\n');
                scope.assert.equal(result.stderr, '');
                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'packaged Stryker runner validates profiles before test imports'
        })
    ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/package-smoke/stryker-runner.test.ts'
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
