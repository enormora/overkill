import { execFile } from 'node:child_process';
import { createSuite, createTestCase } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';
import { runIfMain } from './direct-launcher.test.ts';
import { benchAuthoringScript, benchMacroScript } from './bench-scripts.test.ts';

type ScriptOutput = {
    readonly stderr: string;
    readonly stdout: string;
};

async function executeNode(script: string): Promise<ScriptOutput> {
    return await new Promise(function executeScript(resolve, reject) {
        execFile(process.execPath, [ '--input-type=module', '--eval', script ], {
            cwd: import.meta.dirname,
            encoding: 'utf8'
        }, function collectResult(error, stdout, stderr) {
            if (error instanceof Error) {
                reject(error);
            } else {
                resolve({ stderr, stdout });
            }
        });
    });
}

export const testNode = createSuite({
    annotations: {},
    children: [
        createTestCase({
            annotations: {},
            async body(scope) {
                const result = await executeNode(benchAuthoringScript);

                scope.assert.equal(result.stdout, 'bench authoring passed\n');
                scope.assert.equal(result.stderr, '');
                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'packaged bench facade composes with standard authoring and the public engine'
        }),
        createTestCase({
            annotations: {},
            async body(scope) {
                const result = await executeNode(benchMacroScript);

                scope.assert.equal(result.stdout, 'bench macro locations passed\n');
                scope.assert.equal(result.stderr, '');
                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'packaged copies share nested macro locations and restore them after errors'
        })
    ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/integration-tests/package-smoke/bench.test.ts'
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
