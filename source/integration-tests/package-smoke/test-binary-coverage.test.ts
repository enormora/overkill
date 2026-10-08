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
    coverageGeneratedScript,
    coverageSourceFile,
    coverageTypeScriptSource,
    coverageNativeTypeScriptSource,
    type CoverageSourceKind
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

function assertCoverageDiagnostics(scope: TestScope, stderr: string): void {
    scope.assert.match(
        stderr,
        /^\(node:\d+\) ExperimentalWarning: stripTypeScriptTypes is an experimental feature and might change at any time\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n$/u
    );
}

function assertGenericBranches(scope: TestScope, sourceCoverage: string): void {
    scope.assert.deepEqual(
        Array.from(sourceCoverage.matchAll(/^BRDA:3,0,[01],(?<count>\d+)$/gmu), function branchCount(match) {
            return Number(match.groups?.count);
        }),
        [ 2, 1 ]
    );
    scope.assert.includes(sourceCoverage, 'BRF:2\nBRH:2\n');
}

function assertConsumerCoverage(scope: TestScope, lcov: string, sourceKind: CoverageSourceKind): void {
    const file = coverageSourceFile(sourceKind);
    const sourceCoverage = lcov.split('end_of_record').find(function describesConsumerSource(record) {
        return record.includes(`SF:${file}\n`);
    });

    scope.require.defined(sourceCoverage);
    const coveredLines = { javascript: 'DA:2,1\n', mapped: 'DA:2,1\n', native: 'DA:3,3\n', unloaded: 'DA:1,0\n' };
    scope.assert.includes(sourceCoverage, coveredLines[sourceKind]);
    scope.assert.false(lcov.includes('SF:coverage-smoke.test.mjs'));
    scope.assert.false(lcov.includes('coverage-types.ts'));
    if (sourceKind === 'native') {
        assertGenericBranches(scope, sourceCoverage);
    } else if (sourceKind === 'mapped') {
        scope.assert.false(lcov.includes('SF:coverage-source.mjs'));
    }
}

const processModels = [ 'in-process', 'supervised-process' ] as const;

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'packaged overkill generates coverage reports for consumer source',
    annotations: {},
    controls: {},
    children: processModels.flatMap(function coverageProcess(processModel) {
        return ([ 'javascript', 'mapped', 'native', 'unloaded' ] as const).map(function coverageTest(sourceKind) {
            return createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
                title: `${processModel} ${sourceKind}`,
                annotations: {},
                controls: {},
                async body(scope: TestScope) {
                    await fs.rm(path.join(packageSmokeFolder, 'coverage-smoke'), { force: true, recursive: true });
                    await Promise.all([
                        fs.writeFile(
                            path.join(packageSmokeFolder, 'coverage-overkill.config.js'),
                            createCoverageConfigScript(processModel, sourceKind)
                        ),
                        fs.writeFile(
                            path.join(packageSmokeFolder, 'coverage-source.mjs'),
                            coverageGeneratedScript(sourceKind)
                        ),
                        fs.writeFile(
                            path.join(packageSmokeFolder, 'coverage-source.ts'),
                            sourceKind === 'native' ? coverageNativeTypeScriptSource : coverageTypeScriptSource
                        ),
                        fs.writeFile(
                            path.join(packageSmokeFolder, 'coverage-types.ts'),
                            '/** Domain type. */\nexport type Value = number;\n'
                        ),
                        fs.writeFile(
                            path.join(packageSmokeFolder, 'coverage-unloaded.ts'),
                            'export function untouched(): number { return 42; }\n'
                        ),
                        fs.writeFile(
                            path.join(packageSmokeFolder, 'coverage-smoke.test.mjs'),
                            coverageSmokeScript(sourceKind)
                        )
                    ]);

                    const result = await runPackagedCoverage();
                    const lcov = await fs.readFile(path.join(packageSmokeFolder, 'coverage-smoke/lcov.info'), 'utf8');

                    assertCoverageDiagnostics(scope, result.stderr);
                    scope.assert.includes(result.stdout, '1 discovered, 1 planned, 1 executed');
                    assertConsumerCoverage(scope, lcov, sourceKind);

                    return scope.assert.collect();
                }
            });
        });
    })
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
