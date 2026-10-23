import { execFile } from 'node:child_process';
import { createSuite, createTestCase, type TestCase } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';
import { runIfMain } from '#test-runner';
import { strykerPackageScenarios, type StrykerPackageScenario } from './stryker-package-scenarios.test.ts';

type ScriptOutput = {
    readonly stderr: string;
    readonly stdout: string;
};

function createStrykerSmokeCase(scenario: StrykerPackageScenario): TestCase {
    const { title, script } = scenario;
    return createTestCase({
        annotations: {},
        async body(scope) {
            const result = await new Promise<ScriptOutput>(function executePackagedStrykerRunner(resolve, reject) {
                execFile(
                    process.execPath,
                    [ '--input-type=module', '--eval', script ],
                    { cwd: import.meta.dirname, timeout: 120_000 },
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
        title
    });
}

export const testNode = createSuite({
    annotations: {},
    children: strykerPackageScenarios.map(createStrykerSmokeCase),
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/package-smoke/stryker-runner.test.ts'
});

await runIfMain(import.meta, testNode, { reporters: [ createLineReporter() ] });
