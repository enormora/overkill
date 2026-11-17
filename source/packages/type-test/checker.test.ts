import { mkdtemp, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectConfigKind, environmentOptions } from 'tstyche/api';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { loadProject, disposeProject, type FrozenProject } from './frozen-project.ts';
import { checkGeneratedInputs, type CheckerRequest } from './checker.entry-point.ts';
import { verifyCheckerEvidence } from './checker-evidence.ts';

async function compilerProject(scope: TestScope, directory: string): Promise<FrozenProject> {
    const frozen = await loadProject(join(directory, 'tsconfig.json'), {
        kind: 'package',
        specifier: 'typescript-beta',
        version: '7.1.0-beta'
    }, process.cwd());
    scope.cleanup(async function () {
        await disposeProject(frozen);
    });
    return frozen;
}

async function writeProject(directory: string, includeReferences: boolean): Promise<void> {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    await mkdir(join(directory, 'dependency'));
    await mkdir(join(directory, 'config'));
    await writeFile(
        join(directory, 'dependency/tsconfig.json'),
        JSON.stringify({ compilerOptions: { composite: true }, files: [ 'index.ts' ] })
    );
    await writeFile(join(directory, 'dependency/index.ts'), 'export {};');
    await writeFile(
        join(directory, 'config/base.json'),
        JSON.stringify({
            compilerOptions: {
                strict: false,
                noEmit: true,
                types: [],
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                paths: { alias: [ '../value.ts' ] }
            }
        })
    );
    await writeFile(
        join(directory, 'tsconfig.json'),
        JSON.stringify({
            extends: './config/base.json',
            files: [ 'ambient.d.ts', 'input.ts', 'value.ts' ],
            references: includeReferences ? [ { path: './dependency' } ] : []
        })
    );
    await writeFile(join(directory, 'ambient.d.ts'), 'declare const ambient: string;');
    await writeFile(join(directory, 'value.ts'), 'export type Value = string;');
}

async function fixture(scope: TestScope, includeReferences: boolean): Promise<CheckerRequest> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-checker-'));
    scope.cleanup(async function () {
        await rm(directory, { recursive: true, force: true });
    });
    await writeProject(directory, includeReferences);
    const text =
        "import { expect } from 'tstyche';\nimport type { Value } from 'alias';\nexpect<Value>().type.toBe<typeof ambient>();\nexpect<null>().type.toBeAssignableTo<string>();\n";
    const path = join(directory, 'input.ts');
    await writeFile(path, text);
    return {
        project: await compilerProject(scope, directory),
        projectConfigPath: join(directory, 'tsconfig.json'),
        modules: [ {
            path,
            text,
            originalText: text,
            mappings: [ {
                kind: 'copied' as const,
                generated: { start: 0, end: text.length },
                original: { start: 0, end: text.length }
            } ]
        } ]
    };
}

export const testNode = suite('explicit checker configuration', [
    test('preserves inherited resolution and ambient roots', async function (scope) {
        const request = await fixture(scope, false);
        await scope.assert.rejects(async function empty() {
            await checkGeneratedInputs({ ...request, modules: [] });
        }, { message: 'No translated inputs to check.' });
        const results = await Promise.all([
            checkGeneratedInputs(request),
            checkGeneratedInputs(request),
            checkGeneratedInputs(request)
        ]);
        scope.assert.equal(results[2].compilerVersion, '7.1.0-beta');
        for (const result of results) {
            scope.assert.equal(
                result
                    .events
                    .filter(function passed(event) {
                        return event[0] === 'expect:pass';
                    })
                    .length,
                2
            );
        }
        const names = await readdir(join(request.projectConfigPath, '..'));
        scope.assert.equal(
            names.some(function generated(name) {
                return name.startsWith('.overkill-type-test-');
            }),
            false
        );
        return scope.assert.collect();
    }),
    test('restores compiler binding after successful and failed checks', async function (scope) {
        const request = await fixture(scope, false);
        const previous = environmentOptions.typescriptSpecifier;
        await checkGeneratedInputs(request);
        scope.assert.equal(environmentOptions.typescriptSpecifier, previous);
        await scope.assert.rejects(async function () {
            return checkGeneratedInputs({
                ...request,
                modules: request.modules.map(function stale(module) {
                    return { ...module, originalText: `${module.originalText}changed` };
                })
            });
        }, { message: /Original source changed/u });
        scope.assert.equal(environmentOptions.typescriptSpecifier, previous);
        return scope.assert.collect();
    }),
    test('rejects project references before creating generated checker inputs', async function (scope) {
        const request = await fixture(scope, true);
        const directory = join(request.projectConfigPath, '..');
        const before = await readdir(directory);
        await scope.assert.rejects(async function () {
            await checkGeneratedInputs(request);
        }, { message: /Project references require original-source checking/u });
        scope.assert.deepEqual(await readdir(directory), before);
        return scope.assert.collect();
    }),
    test('rejects fallback, wrong compilers and missing evidence', function (scope) {
        for (const kind of [ ProjectConfigKind.Default, ProjectConfigKind.Provided ]) {
            scope.assert.throws(function () {
                verifyCheckerEvidence(
                    [
                        [ 'project:uses', {
                            compilerVersion: 'wrong',
                            projectConfig: { kind, specifier: '/expected.json' }
                        } ]
                    ],
                    '/expected.json',
                    '6.0.3',
                    [ '/input.ts' ]
                );
            }, { message: /Unexpected checker/u });
        }
        scope.assert.throws(function () {
            verifyCheckerEvidence([], '/expected.json', '6.0.3', [ '/input.ts' ]);
        }, {
            message: /Missing checker/u
        });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
