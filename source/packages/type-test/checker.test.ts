import { mkdtemp, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectConfigKind } from 'tstyche/api';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { checkGeneratedInputs, type CheckerRequest } from './checker.entry-point.ts';
import { verifyCheckerEvidence } from './checker-evidence.ts';

async function writeProject(directory: string): Promise<void> {
    await mkdir(join(directory, 'dependency'));
    await writeFile(
        join(directory, 'dependency/tsconfig.json'),
        JSON.stringify({ compilerOptions: { composite: true }, files: [ 'index.ts' ] })
    );
    await writeFile(join(directory, 'dependency/index.ts'), 'export {};');
    await writeFile(
        join(directory, 'base.json'),
        JSON.stringify({
            compilerOptions: {
                strict: false,
                noEmit: true,
                types: [],
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                paths: { alias: [ './value.ts' ] }
            }
        })
    );
    await writeFile(
        join(directory, 'tsconfig.json'),
        JSON.stringify({
            extends: './base.json',
            files: [ 'ambient.d.ts', 'input.ts', 'value.ts' ],
            references: [ { path: './dependency' } ]
        })
    );
    await writeFile(join(directory, 'ambient.d.ts'), 'declare const ambient: string;');
    await writeFile(join(directory, 'value.ts'), 'export type Value = string;');
}
async function fixture(scope: TestScope): Promise<CheckerRequest> {
    const directory = await mkdtemp(join(process.cwd(), 'target-checker-'));
    scope.cleanup(async function () {
        await rm(directory, { recursive: true, force: true });
    });
    await writeProject(directory);
    const text =
        "import { expect } from 'tstyche';\nimport type { Value } from 'alias';\nexpect<Value>().type.toBe<typeof ambient>();\nexpect<null>().type.toBeAssignableTo<string>();\n";
    const path = join(directory, 'input.ts');
    await writeFile(path, text);
    return {
        compiler: { kind: 'local' as const },
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
    test('preserves inherited resolution, ambient roots and references', async function (scope) {
        const request = await fixture(scope);
        await scope.assert.rejects(async function empty() {
            await checkGeneratedInputs({ ...request, modules: [] });
        }, { message: 'No translated inputs to check.' });
        const results = await Promise.all([
            checkGeneratedInputs(request),
            checkGeneratedInputs(request),
            checkGeneratedInputs({ ...request, compiler: { kind: 'version', version: '5.9.3' } })
        ]);
        scope.assert.equal(results[2].compilerVersion, '5.9.3');
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
