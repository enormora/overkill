import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import * as compiler from 'typescript';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { withGeneratedInputs, type TranslatedModule } from './generated-input.entry-point.ts';

async function project(scope: TestScope): Promise<{ readonly directory: string; readonly module: TranslatedModule; }> {
    const directory = await mkdtemp(join(process.cwd(), 'target-identity-'));
    scope.cleanup(async function cleanup() {
        await rm(directory, { recursive: true, force: true });
    });
    const text =
        "import { make } from './dependency.js';\nexport class Nominal { private value = 1; }\nconst checked: Nominal = make();";
    await writeFile(join(directory, 'original.ts'), text);
    await writeFile(
        join(directory, 'dependency.ts'),
        "import { Nominal } from './original.js';\nexport function make(): Nominal { return new Nominal(); }"
    );
    await writeFile(
        join(directory, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { types: [], noEmit: true }, include: [ '*.ts' ] })
    );
    return {
        directory,
        module: {
            path: join(directory, 'original.ts'),
            text,
            originalText: text,
            mappings: [ {
                kind: 'copied',
                original: { start: 0, end: text.length },
                generated: { start: 0, end: text.length }
            } ]
        }
    };
}
function diagnostics(path: string): readonly number[] {
    const program = compiler.createProgram([ path ], {
        module: compiler.ModuleKind.NodeNext,
        strict: true,
        noEmit: true,
        types: []
    });
    return compiler.getPreEmitDiagnostics(program).map(function code(diagnostic) {
        return diagnostic.code;
    });
}
export const testNode = suite('generated identity limits', [
    test('demonstrates the transitive nominal identity limitation', async function (scope: TestScope) {
        const { directory, module } = await project(scope);
        scope.assert.deepEqual(diagnostics(module.path), []);
        await withGeneratedInputs({
            compiler,
            projectConfigPath: join(directory, 'tsconfig.json'),
            modules: [ module ]
        }, async function check(batch) {
            const result = batch.modules[0];
            if (result?.kind !== 'ready') {
                throw new Error('Missing generated module.');
            }
            scope.assert.equal(diagnostics(result.path).includes(2322), true);
            scope.assert.equal(result.provenance.limitations.length > 0, true);
            scope.assert.deepEqual(result.provenance.repairs, []);
        });
        return scope.assert.collect();
    }),
    test('repairs cycles when both nominal modules are translated', async function (scope: TestScope) {
        const { directory, module } = await project(scope);
        const path = join(directory, 'dependency.ts');
        const text = await readFile(path, 'utf8');
        const dependency: TranslatedModule = {
            path,
            text,
            originalText: text,
            mappings: [
                { kind: 'copied', generated: { start: 0, end: text.length }, original: { start: 0, end: text.length } }
            ]
        };
        await withGeneratedInputs({
            compiler,
            projectConfigPath: join(directory, 'tsconfig.json'),
            modules: [ module, dependency ]
        }, async function check(batch) {
            scope.assert.equal(batch.modules.length, 2);
            for (const result of batch.modules) {
                if (result.kind !== 'ready') {
                    throw new Error('Missing cycle input.');
                }
                scope.assert.deepEqual(diagnostics(result.path), []);
                scope.assert.equal(result.provenance.repairs.length, 1);
            }
        });
        return scope.assert.collect();
    }),
    test('isolates overlapping operations on the same original', async function (scope: TestScope) {
        const { directory, module } = await project(scope);
        const request = { compiler, projectConfigPath: join(directory, 'tsconfig.json'), modules: [ module ] };
        await withGeneratedInputs(request, async function outer(first) {
            await withGeneratedInputs(request, async function inner(second) {
                const names = await readdir(directory);
                scope.assert.equal(
                    names
                        .filter(function generated(name) {
                            return name.startsWith('.');
                        })
                        .length,
                    2
                );
                const left = first.modules[0];
                const right = second.modules[0];
                if (left?.kind !== 'ready' || right?.kind !== 'ready') {
                    throw new Error('Missing generated modules.');
                }
                scope.assert.equal(left.path === right.path, false);
            });
        });
        const names = await readdir(directory);
        scope.assert.equal(
            names.some(function generated(name) {
                return name.startsWith('.');
            }),
            false
        );
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
