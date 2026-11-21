import type { ConsumerScope } from './support/package-consumer.ts';
import type { ParameterizedTestScope } from '@overkill-dev/test';
import { consumerEnvironment } from './support/consumer-environment.ts';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { suite } from '@overkill-dev/test';
import { packageConsumer } from './support/package-consumer.ts';

const consumerFacade = packageConsumer('Installed CLI coverage', function consumerFixture(consumerDirectory) {
    const packageSmokeFolder = fileURLToPath(pathToFileURL(`${consumerDirectory}/`));
    const overkillBinEntryPointPath = path.join(
        packageSmokeFolder,
        'node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js'
    );
    async function runPackagedCoverage(): Promise<{ readonly stderr: string; readonly stdout: string; }> {
        await fs.chmod(overkillBinEntryPointPath, 0o700);
        return await new Promise(function executeCoverage(resolve, reject) {
            execFile(
                overkillBinEntryPointPath,
                [
                    'run',
                    '--coverage',
                    '--config',
                    'coverage-overkill.config.js',
                    'coverage-smoke.test.mjs'
                ],
                { env: consumerEnvironment(process.env, packageSmokeFolder), cwd: packageSmokeFolder },
                function collectResult(error, stdout, stderr) {
                    if (error instanceof Error) {
                        reject(new Error(`Packaged coverage failed:\n${stdout}${stderr}`, { cause: error }));
                    } else {
                        resolve({ stderr, stdout });
                    }
                }
            );
        });
    }
    return { packageSmokeFolder, runPackagedCoverage };
});
const { table } = consumerFacade;

import {
    createCoverageConfigScript,
    coverageSmokeScript,
    coverageGeneratedScript,
    coverageSourceFile,
    coverageTypeScriptSource,
    coverageNativeTypeScriptSource
} from './support/package-coverage-scripts.ts';

const assertCoverageDiagnostics = defineCompositeAssertion({
    name: 'coverage diagnostics',
    assert(check, stderr: string) {
        return check.group([ check.match(
            stderr,
            /^\(node:\d+\) ExperimentalWarning: stripTypeScriptTypes is an experimental feature and might change at any time\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n$/u
        ) ]);
    }
});

const assertGenericBranches = defineCompositeAssertion({
    name: 'generic branches',
    assert(check, sourceCoverage: string) {
        return check.group([
            check.deepEqual(
                Array.from(sourceCoverage.matchAll(/^BRDA:3,0,[01],(?<count>\d+)$/gmu), function branchCount(match) {
                    return Number(match.groups?.count);
                }),
                [ 2, 1 ]
            ),
            check.includes(sourceCoverage, 'BRF:2\nBRH:2\n')
        ]);
    }
});

const processModels = [ 'in-process', 'supervised-process' ] as const;

export const testNode = suite(
    'Installed CLI coverage',
    [ table({
        title: 'reports consumer source coverage across execution boundaries',
        cases: processModels.flatMap(function coverageProcess(processModel) {
            return ([ 'javascript', 'mapped', 'native', 'unloaded' ] as const).map(function coverageTest(sourceKind) {
                return { processModel, sourceKind };
            });
        }),
        caseTitle({ processModel, sourceKind }) {
            return [ processModel, sourceKind ].map(String).join(', ');
        },
        async test(
            scope: ParameterizedTestScope<
                {
                    readonly processModel: (typeof processModels)[number];
                    readonly sourceKind: 'javascript' | 'mapped' | 'native' | 'unloaded';
                },
                ConsumerScope<typeof consumerFacade>
            >
        ) {
            const { packageSmokeFolder, runPackagedCoverage } = scope.resources.consumer;

            const { processModel, sourceKind } = scope.parameters;

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

            scope.assert(assertCoverageDiagnostics, result.stderr);
            scope.assert.includes(result.stdout, '1 discovered, 1 planned, 1 executed');

            const consumerCoverageFile = coverageSourceFile(sourceKind);
            const consumerCoverageSourceCoverage = lcov.split('end_of_record').find(
                function describesConsumerSource(record) {
                    return record.includes(`SF:${consumerCoverageFile}\n`);
                }
            );

            scope.require.defined(consumerCoverageSourceCoverage);
            const consumerCoverageCoveredLines = {
                javascript: 'DA:2,1\n',
                mapped: 'DA:2,1\n',
                native: 'DA:3,3\n',
                unloaded: 'DA:1,0\n'
            };
            scope.assert.includes(consumerCoverageSourceCoverage, consumerCoverageCoveredLines[sourceKind]);
            scope.assert.false(lcov.includes('SF:coverage-smoke.test.mjs'));
            scope.assert.false(lcov.includes('coverage-types.ts'));
            if (sourceKind === 'native') {
                scope.assert(assertGenericBranches, consumerCoverageSourceCoverage);
            } else if (sourceKind === 'mapped') {
                scope.assert.false(lcov.includes('SF:coverage-source.mjs'));
            }

            return scope.assert.collect();
        }
    }) ]
);
