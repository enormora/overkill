import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import { API, ModuleKind } from 'typescript-beta/async';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { createCompilerLifetime } from './compiler-lifetime.ts';
import type { GeneratedInputRequest } from './generated-input-types.ts';
import { loadProject, disposeProject, type FrozenProject } from './frozen-project.ts';
import { checkGeneratedInputs } from './checker.entry-point.ts';
import { withGeneratedInputs, type TranslatedModule } from './generated-input.entry-point.ts';

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

async function compilerInput(
    scope: TestScope,
    directory: string
): Promise<Pick<GeneratedInputRequest, 'compiler' | 'project'>> {
    const frozen = await compilerProject(scope, directory);
    return { project: frozen, compiler: frozen.compiler.syntax };
}

async function fixture(scope: TestScope): Promise<string> {
    const directory = await mkdtemp(join(process.cwd(), 'target-generated-'));
    scope.cleanup(async function cleanup() {
        await rm(directory, { recursive: true, force: true });
    });
    await writeFile(
        join(directory, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                strict: true,
                noEmit: true,
                allowImportingTsExtensions: true,
                types: []
            },
            include: [ '*.ts', '*.tsx', '*.mts', '*.cts' ]
        })
    );
    return directory;
}

async function source(directory: string, name: string, text: string): Promise<TranslatedModule> {
    const path = join(directory, name);
    await writeFile(path, text);
    return {
        path,
        text,
        originalText: text,
        mappings: [ {
            kind: 'copied',
            generated: { start: 0, end: text.length },
            original: { start: 0, end: text.length }
        } ]
    };
}

async function generatedNames(directory: string): Promise<readonly string[]> {
    const names = await readdir(directory);
    return names.filter(function generated(path) {
        return path.startsWith('.');
    });
}

async function checkerEvents(directory: string, module: TranslatedModule): Promise<{
    readonly events: readonly string[];
    readonly versions: readonly string[];
    readonly checkerConfigPath: string;
}> {
    const project = await loadProject(join(directory, 'tsconfig.json'), {
        kind: 'package',
        specifier: 'typescript-beta',
        version: '7.1.0-beta'
    }, process.cwd());
    try {
        const result = await checkGeneratedInputs({
            project,
            projectConfigPath: join(directory, 'tsconfig.json'),
            modules: [ module ]
        });
        const events = result.events.map(function name(event) {
            return event[0];
        });
        const versions = result.events.flatMap(function identity(event) {
            return event[0] === 'project:uses'
                ? [ `${event[1].compilerVersion}@${event[1].projectConfig.specifier}` ]
                : [];
        });
        return { events, versions, checkerConfigPath: result.checkerConfigPath };
    } finally {
        await disposeProject(project);
    }
}

async function assertNoDiagnostics(scope: TestScope, path: string): Promise<void> {
    await using lifetime = createCompilerLifetime();
    await lifetime.run(async function execute() {
        await using api = new API();
        await using program = await api.createProgram([ path ], {
            strict: true,
            noEmit: true,
            module: ModuleKind.NodeNext,
            allowImportingTsExtensions: true,
            types: []
        });
        const diagnostics = await program.getSemanticDiagnostics();
        scope.assert.equal(diagnostics.length, 0);
    });
}

export const testNode = suite('generated type-test input', [
    test('repairs direct nominal self-imports and retains original locations', async function (scope: TestScope) {
        const directory = await fixture(scope);
        const module = await source(
            directory,
            'self.ts',
            "import type { Nominal as Self } from './self.ts';\nexport class Nominal { private value = 1; }\nconst value: Self = new Nominal();\n"
        );
        await withGeneratedInputs({
            ...await compilerInput(scope, directory),
            projectConfigPath: join(directory, 'tsconfig.json'),
            modules: [ module ]
        }, async function check(batch) {
            const result = batch.modules[0];
            scope.assert.equal(result?.kind, 'ready');
            if (result?.kind !== 'ready') {
                throw new Error('Expected ready module.');
            }
            const text = await readFile(result.path, 'utf8');
            scope.assert.equal(text.includes('from "./.overkill-type-test-'), true);
            scope.assert.equal(result.provenance.repairs.length, 1);
            await assertNoDiagnostics(scope, result.path);
            scope.assert.deepEqual(batch.mapRange(result.path, { start: 0, end: 6 }, 'generated'), [ {
                start: 0,
                end: 6
            } ]);
        });
        scope.assert.equal(await readFile(module.path, 'utf8'), module.originalText);
        scope.assert.deepEqual(await generatedNames(directory), []);
        return scope.assert.collect();
    }),
    test('propagates ambiguity only through supplied translated dependencies', async function (scope: TestScope) {
        const directory = await fixture(scope);
        const modules = await Promise.all([
            source(directory, 'bad.ts', "import './missing.ts';\nexport {};"),
            source(directory, 'dependent.ts', "import './bad.ts';\nexport {};"),
            source(directory, 'independent.mts', 'export const value = 1;')
        ]);
        await withGeneratedInputs({
            ...await compilerInput(scope, directory),
            projectConfigPath: join(directory, 'tsconfig.json'),
            modules
        }, async function check(batch) {
            scope.assert.deepEqual(
                batch.modules.map(function kind(module) {
                    return module.kind;
                }),
                [ 'ambiguous', 'ambiguous', 'ready' ]
            );
            const names = await generatedNames(directory);
            scope.assert.equal(names.length, 1);
        });
        return scope.assert.collect();
    }),
    test('uses public checker events for both verdicts and the selected compiler', async function (scope: TestScope) {
        const directory = await fixture(scope);
        const module = await source(
            directory,
            'checker.ts',
            "import { expect } from 'tstyche';\nexpect<string>().type.toBe<string>();\nexpect<string>().type.toBe<number>();\n"
        );
        const { events, versions, checkerConfigPath } = await checkerEvents(directory, module);
        scope.assert.equal(
            events
                .filter(function passed(event) {
                    return event === 'expect:pass';
                })
                .length,
            1
        );
        scope.assert.equal(
            events
                .filter(function failed(event) {
                    return event === 'expect:fail';
                })
                .length,
            1
        );
        scope.assert.deepEqual(versions, [ `7.1.0-beta@${checkerConfigPath}` ]);
        return scope.assert.collect();
    }),
    test('preserves edited files and reports cleanup failure', async function (scope: TestScope) {
        const directory = await fixture(scope);
        const module = await source(directory, 'edited.tsx', 'export const value = 1;');
        let path = '';
        await scope.assert.rejects(async function modify() {
            await withGeneratedInputs({
                ...await compilerInput(scope, directory),
                projectConfigPath: join(directory, 'tsconfig.json'),
                modules: [ module ]
            }, async function edit(batch) {
                const result = batch.modules[0];
                if (result?.kind !== 'ready') {
                    throw new Error('Missing input.');
                }
                path = result.path;
                await writeFile(path, 'user content');
            });
        }, { message: 'Generated input cleanup failed.' });
        scope.assert.equal(await readFile(path, 'utf8'), 'user content');
        return scope.assert.collect();
    }),
    test('rejects project inclusion and removes generated files', async function (scope: TestScope) {
        const directory = await fixture(scope);
        const module = await source(directory, 'included.ts', 'export const value = 1;');
        await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ include: [ '*.ts', '.*.ts' ] }));
        await scope.assert.rejects(async function prepare() {
            await withGeneratedInputs({
                ...await compilerInput(scope, directory),
                projectConfigPath: join(directory, 'tsconfig.json'),
                modules: [ module ]
            }, async function unexpected() {
                throw new Error('Callback must not run.');
            });
        }, { message: /Original project discovers generated inputs/u });
        scope.assert.deepEqual(await generatedNames(directory), []);
        return scope.assert.collect();
    }),
    test('rejects duplicate originals and stale snapshots before writing', async function (scope: TestScope) {
        const directory = await fixture(scope);
        const module = await source(directory, 'snapshot.ts', 'export const value = 1;');
        await scope.assert.rejects(async function duplicate() {
            await withGeneratedInputs({
                ...await compilerInput(scope, directory),
                projectConfigPath: join(directory, 'tsconfig.json'),
                modules: [ module, module ]
            }, async function unexpected() {
                throw new Error('Callback must not run.');
            });
        }, { message: /Invalid or duplicate original path/u });
        await writeFile(module.path, 'export const value = 2;');
        await scope.assert.rejects(async function changed() {
            await withGeneratedInputs({
                ...await compilerInput(scope, directory),
                projectConfigPath: join(directory, 'tsconfig.json'),
                modules: [ module ]
            }, async function unexpected() {
                throw new Error('Callback must not run.');
            });
        }, { message: /Original source changed/u });
        scope.assert.deepEqual(await generatedNames(directory), []);
        return scope.assert.collect();
    }),
    test('cleans owned siblings after callback failure', async function (scope: TestScope) {
        const directory = await fixture(scope);
        const module = await source(directory, 'failure.cts', 'export const value = 1;');
        await scope.assert.rejects(async function fail() {
            await withGeneratedInputs({
                ...await compilerInput(scope, directory),
                projectConfigPath: join(directory, 'tsconfig.json'),
                modules: [ module ]
            }, async function reject() {
                throw new Error('callback failed');
            });
        }, { message: 'callback failed' });
        scope.assert.deepEqual(await generatedNames(directory), []);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
