import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSuite, createTestCase, type TestScope } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';
import { runIfMain } from './direct-launcher.test.ts';
import {
    createCoverageConfigScript,
    coverageSmokeScript,
    coverageSourceScript
} from './package-coverage-scripts.test.ts';

const packageSmokeFolder = fileURLToPath(new URL('.', import.meta.url));
const overkillBinEntryPointPath = path.join(
    packageSmokeFolder,
    'node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js'
);

async function runPackagedCoverage(): Promise<{ readonly stderr: string; readonly stdout: string; }> {
    return await new Promise(function executeCoverage(resolve, reject) {
        execFile(
            process.execPath,
            [
                overkillBinEntryPointPath,
                'run',
                '--coverage',
                '--config',
                'coverage-overkill.config.js',
                'coverage-smoke.test.mjs'
            ],
            { cwd: packageSmokeFolder },
            function collectResult(error, stdout, stderr) {
                if (error instanceof Error) {
                    reject(error);
                } else {
                    resolve({ stderr, stdout });
                }
            }
        );
    });
}

function assertConsumerCoverage(scope: TestScope, lcov: string): void {
    const sourceCoverage = lcov.split('end_of_record').find(function describesConsumerSource(record) {
        return record.includes('SF:coverage-source.mjs\n');
    });

    scope.require.defined(sourceCoverage);
    scope.assert.includes(sourceCoverage, 'DA:2,1\n');
    scope.assert.false(lcov.includes('SF:coverage-smoke.test.mjs'));
}

const processModels = [ 'in-process', 'supervised-process' ] as const;

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'packaged overkill generates coverage reports for consumer source',
    annotations: {},
    controls: {},
    children: processModels.map(function coverageTest(processModel) {
        return createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: processModel,
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await fs.rm(path.join(packageSmokeFolder, 'coverage-smoke'), { force: true, recursive: true });
                await Promise.all([
                    fs.writeFile(
                        path.join(packageSmokeFolder, 'coverage-overkill.config.js'),
                        createCoverageConfigScript(processModel)
                    ),
                    fs.writeFile(path.join(packageSmokeFolder, 'coverage-source.mjs'), coverageSourceScript),
                    fs.writeFile(path.join(packageSmokeFolder, 'coverage-smoke.test.mjs'), coverageSmokeScript)
                ]);

                const result = await runPackagedCoverage();
                const lcov = await fs.readFile(path.join(packageSmokeFolder, 'coverage-smoke/lcov.info'), 'utf8');

                scope.assert.equal(result.stderr, '');
                scope.assert.includes(result.stdout, '1 discovered, 1 planned, 1 executed');
                assertConsumerCoverage(scope, lcov);

                return scope.assert.collect();
            }
        });
    })
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
