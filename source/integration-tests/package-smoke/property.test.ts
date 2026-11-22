import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';

import path from 'node:path';
import { suite } from '@overkill-dev/test';
import { createProgram, ModuleKind, ScriptTarget } from 'typescript';
import { packageConsumer } from './support/package-consumer.ts';

import { consumerEnvironment } from './support/consumer-environment.ts';
import { consumerCompilerTypes, consumerTypeDiagnostics } from './support/consumer-types.ts';

import {
    microtestLoadBoundaryScript,
    propertyAuthoringScript,
    propertyCodecScript,
    propertyReplayScript,
    propertyLoadBoundaryScript,
    propertySubpathScript,
    propertyTypeScript
} from './support/property-scripts.ts';

type ScriptOutput = { readonly code: number; readonly stdout: string; readonly stderr: string; };

async function runNode(argumentsList: readonly string[], cwd: string): Promise<ScriptOutput> {
    return await new Promise(function executeScript(resolve, reject) {
        execFile(
            process.execPath,
            [ '--disable-warning=PERM0004', ...Array.from(argumentsList) ],
            { env: consumerEnvironment(cwd), cwd, encoding: 'utf8' },
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

const consumerFacade = packageConsumer('packaged property authoring', function consumerFixture(consumerDirectory) {
    async function standardConsumer(): Promise<string> {
        const directory = await mkdtemp(path.join(consumerDirectory, 'overkill-property-consumer-'));

        const packages = path.join(directory, 'node_modules/@overkill-dev');
        await mkdir(packages, { recursive: true });
        await cp(path.join(consumerDirectory, 'node_modules/@overkill-dev/test'), path.join(packages, 'test'), {
            recursive: true
        });
        return directory;
    }
    return { consumerDirectory, standardConsumer };
});
const { test } = consumerFacade;

export const testNode = suite('packaged property authoring', [
    test('packaged witness replay preserves lifecycle and input graphs', async function (scope) {
        const { consumerDirectory } = scope.resources.consumer;

        const result = await runNode(
            [ '--input-type=module', '--eval', propertyReplayScript ],
            consumerDirectory
        );
        scope.assert.equal(result.code, 0);
        scope.assert.equal(result.stderr, '');
        scope.assert.includes(result.stdout, 'Packaged witness replay passed');
        return scope.assert.collect();
    }),
    test('runner codec boundary preserves historical decoding in published packages', async function (scope) {
        const { consumerDirectory } = scope.resources.consumer;

        const result = await runNode(
            [ '--input-type=module', '--eval', propertyCodecScript ],
            consumerDirectory
        );
        scope.assert.equal(result.code, 0);
        scope.assert.equal(result.stderr, '');
        scope.assert.equal(result.stdout, 'property codecs passed\n');
        return scope.assert.collect();
    }),
    test('packaged leaf and standard declarations share nominal generator types', async function (scope) {
        const { consumerDirectory } = scope.resources.consumer;

        const sourcePath = path.join(consumerDirectory, 'property-consumer.mts');
        await writeFile(sourcePath, propertyTypeScript);
        const program = createProgram([ sourcePath ], {
            ...consumerCompilerTypes,
            module: ModuleKind.NodeNext,
            target: ScriptTarget.ESNext,
            strict: true,
            noEmit: true,
            types: [ 'node' ]
        });
        scope.assert.deepEqual(
            await consumerTypeDiagnostics(program, consumerDirectory),
            []
        );
        return scope.assert.collect();
    }),
    test('leaf and standard package copies share property ownership and declarations', async function (scope) {
        const { consumerDirectory } = scope.resources.consumer;

        const result = await runNode(
            [ '--input-type=module', '--eval', propertyAuthoringScript ],
            consumerDirectory
        );
        scope.assert.equal(result.code, 0);
        scope.assert.equal(result.stderr, '');
        scope.assert.equal(result.stdout, 'property authoring passed\n');
        return scope.assert.collect();
    }),
    test(
        'standard-only installation exposes property authoring without loading it at the root',
        async function (scope) {
            const { standardConsumer } = scope.resources.consumer;

            const directory = await standardConsumer();
            for (const script of [ propertySubpathScript, propertyLoadBoundaryScript ]) {
                const result = await runNode([ '--input-type=module', '--eval', script ], directory);
                scope.assert.equal(result.code, 0);
                scope.assert.equal(result.stderr, '');
            }
            return scope.assert.collect();
        }
    ),
    test('ordinary microtest CLI startup does not load the installed property package', async function (scope) {
        const { standardConsumer } = scope.resources.consumer;

        const directory = await standardConsumer();
        await writeFile(path.join(directory, 'load-boundary.mjs'), microtestLoadBoundaryScript);
        await writeFile(
            path.join(directory, 'overkill.config.mjs'),
            `export const config = {
                    profiles: { unit: {
                        testFamily: 'microtest', files: { include: ['ordinary.test.mjs'] },
                        timeouts: { collectionMilliseconds: 30000, softMilliseconds: 500, hardMilliseconds: 1000 }
                    } }
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
    })
]);
