import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, table, type TestScope } from '@overkill-dev/test';

const binary = fileURLToPath(new URL('../../packages/test/overkill.entry-point.ts', import.meta.url));
const fixture = 'source/integration-tests/runtime/fixtures/coverage.test.ts';
const source = 'source/integration-tests/runtime/fixtures/coverage-source.ts';
type CoverageMode = 'in-process' | 'supervised-process';
type CoverageProject = { readonly config: string; readonly output: string; };

async function coverageProject(cleanup: TestScope['cleanup'], mode: CoverageMode): Promise<CoverageProject> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp(resolvePath('target/source-cli-coverage-'));
    cleanup(async function removeProject() {
        await rm(directory, { recursive: true, force: true });
    });
    const config = join(directory, 'overkill.config.ts');
    const output = join(directory, 'coverage');
    const definition = {
        runtimeStateDir: join(directory, 'runtime'),
        profiles: {
            coverage: {
                testFamily: 'microtest',
                execution: { processModel: mode, scheduling: 'concurrent', maxConcurrency: 2 },
                timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 10_000, hardMilliseconds: 15_000 },
                files: { include: [ fixture ] },
                coverage: { sources: { mode: 'all', include: [ source ] }, outputs: [ 'lcov' ], outputDir: output }
            }
        }
    };
    await writeFile(config, `export const config = ${JSON.stringify(definition)};`);
    return { config, output };
}

async function coverageOutput(project: CoverageProject): Promise<string> {
    return await new Promise(function executeSourceCli(resolve, reject) {
        execFile(
            binary,
            [
                'run',
                '--config',
                project.config,
                '--profile',
                'coverage',
                '--coverage',
                '--seed',
                '42'
            ],
            { cwd: process.cwd(), timeout: 60_000 },
            function captureCoverage(error, stdout, stderr) {
                if (error === null) {
                    resolve(stdout);
                } else {
                    reject(new Error([ stdout, stderr ].join('\n'), { cause: error }));
                }
            }
        );
    });
}

export const testNode = suite('Source CLI coverage', [
    table({
        title: 'collects native coverage through either execution mode',
        cases: [ 'in-process', 'supervised-process' ] as const,
        caseTitle(mode) {
            return mode;
        },
        async test(scope) {
            const project = await coverageProject(scope.cleanup, scope.parameters);
            const stdout = await coverageOutput(project);
            const lcov = await readFile(join(project.output, 'lcov.info'), 'utf8');
            scope.assert.match(stdout, /Run passed · 1 passed · [\d.]+ (?:µs|ms|s)$/mu);
            scope.assert.match(stdout, /^ {2}1 executed · [\d.]+ (?:µs|ms|s) execution · /mu);
            scope.assert.includes(lcov, `SF:${source}\n`);
            scope.assert.match(lcov, /^FNDA:1,coveredValue$/mu);
            scope.assert.match(lcov, /^FNDA:0,uncoveredValue$/mu);
            return scope.assert.collect();
        }
    })
]);
