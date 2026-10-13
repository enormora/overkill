import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProgram, getPreEmitDiagnostics, ModuleKind, ScriptTarget } from 'typescript';
import { createSuite, createTestCase, type TestScope } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';
import { runIfMain } from './direct-launcher.test.ts';
import {
    microtestLoadBoundaryScript,
    propertyAuthoringScript,
    propertyLoadBoundaryScript,
    propertySubpathScript,
    propertyTypeScript
} from './property-scripts.test.ts';

type ScriptOutput = { readonly code: number; readonly stdout: string; readonly stderr: string; };

async function runNode(argumentsList: readonly string[], cwd: string): Promise<ScriptOutput> {
    return await new Promise(function executeScript(resolve, reject) {
        execFile(
            process.execPath,
            Array.from(argumentsList),
            { cwd, encoding: 'utf8' },
            function (error, stdout, stderr) {
                if (error === null) {
                    resolve({ code: 0, stdout, stderr });
                } else if (typeof error.code === 'number') {
                    resolve({ code: error.code, stdout, stderr });
                } else {
                    reject(new Error('Failed to execute property consumer.', { cause: error }));
                }
            }
        );
    });
}

async function standardConsumer(scope: TestScope): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), 'overkill-property-consumer-'));
    scope.cleanup(async function () {
        await rm(directory, { recursive: true, force: true });
    });
    const packages = path.join(directory, 'node_modules/@overkill-dev');
    await mkdir(packages, { recursive: true });
    await cp(path.join(import.meta.dirname, 'node_modules/@overkill-dev/test'), path.join(packages, 'test'), {
        recursive: true
    });
    return directory;
}

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

export const testNode = createSuite({
    ...metadata,
    title: 'packaged property authoring',
    children: [
        createTestCase({
            ...metadata,
            title: 'packaged leaf and standard declarations share nominal generator types',
            async body(scope) {
                const sourcePath = path.join(import.meta.dirname, 'property-consumer.mts');
                scope.cleanup(async function () {
                    await rm(sourcePath, { force: true });
                });
                await writeFile(sourcePath, propertyTypeScript);
                const program = createProgram([ sourcePath ], {
                    module: ModuleKind.NodeNext,
                    target: ScriptTarget.ESNext,
                    strict: true,
                    noEmit: true,
                    types: [ 'node' ]
                });
                scope.assert.deepEqual(
                    getPreEmitDiagnostics(program).map(function diagnosticText(diagnostic) {
                        return diagnostic.messageText;
                    }),
                    []
                );
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'leaf and standard package copies share property ownership and declarations',
            async body(scope) {
                const result = await runNode(
                    [ '--input-type=module', '--eval', propertyAuthoringScript ],
                    import.meta.dirname
                );
                scope.assert.equal(result.code, 0);
                scope.assert.equal(result.stderr, '');
                scope.assert.equal(result.stdout, 'property authoring passed\n');
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'standard-only installation exposes property authoring without loading it at the root',
            async body(scope) {
                const directory = await standardConsumer(scope);
                for (const script of [ propertySubpathScript, propertyLoadBoundaryScript ]) {
                    const result = await runNode([ '--input-type=module', '--eval', script ], directory);
                    scope.assert.equal(result.code, 0);
                    scope.assert.equal(result.stderr, '');
                }
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'ordinary microtest CLI startup does not load the installed property package',
            async body(scope) {
                const directory = await standardConsumer(scope);
                await writeFile(path.join(directory, 'load-boundary.mjs'), microtestLoadBoundaryScript);
                await writeFile(
                    path.join(directory, 'overkill.config.mjs'),
                    `export const config = {
                    profiles: { unit: { testFamily: 'microtest', files: { include: ['ordinary.test.mjs'] } } }
                };`
                );
                await writeFile(
                    path.join(directory, 'ordinary.test.mjs'),
                    `
                    import { test } from '@overkill-dev/test';
                    export const testNode = test('ordinary', scope => {
                        scope.assert.equal(Object.hasOwn(scope, 'forall'), false);
                        return scope.assert.collect();
                    });
                `
                );
                const result = await runNode([
                    '--import',
                    path.join(directory, 'load-boundary.mjs'),
                    path.join(directory, 'node_modules/@overkill-dev/test/packages/test/overkill.entry-point.js'),
                    'run',
                    '--config',
                    'overkill.config.mjs',
                    '--profile',
                    'unit'
                ], directory);
                scope.assert.equal(result.code, 0);
                scope.assert.equal(result.stderr, '');
                scope.assert.includes(result.stdout, '1 pass');
                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
