import { execFile } from 'node:child_process';
import { createTestCase, type TestCase } from '@overkill-dev/engine';

export type StrykerPackageScenario = {
    readonly title: string;
    readonly script: string;
};

type ScriptOutput = {
    readonly stderr: string;
    readonly stdout: string;
};

export function createStrykerSmokeCase(scenario: StrykerPackageScenario): TestCase {
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

export function packagedScenario(
    title: string,
    script: string,
    scriptArguments: readonly string[]
): StrykerPackageScenario {
    return {
        title,
        script: `
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const cwd = mkdtempSync(join(tmpdir(), 'overkill-stryker-packaged-'));
const scriptArguments = ${JSON.stringify(scriptArguments)};
const resolvedArguments = scriptArguments.map(value => value.startsWith('@') ? import.meta.resolve(value) : value);
try {
    execFileSync(process.execPath, ['--input-type=module', '--eval', ${JSON.stringify(script)}, ...resolvedArguments],
        {cwd, stdio:'pipe'});
} finally {
    rmSync(cwd, {recursive:true, force:true});
}
console.log('stryker profile initialization passed');
`
    };
}
