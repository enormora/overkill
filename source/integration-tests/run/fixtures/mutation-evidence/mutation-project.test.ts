import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod/v4';

export const mutationModeSchema = z.strictObject({
    processModel: z.enum([ 'in-process', 'supervised-process' ]), freshState: z.boolean()
});
export type MutationMode = Readonly<z.infer<typeof mutationModeSchema>>;
export const mutationModes: readonly MutationMode[] = [ 'in-process', 'supervised-process' ].flatMap(
    function processModes(processModel) {
        return [ false, true ].map(function stateModes(freshState) {
            return mutationModeSchema.parse({ processModel, freshState });
        });
    }
);
export const mutationModulesSchema = z.strictObject({
    adapter: z.string(), core: z.string(), engine: z.string(), config: z.string(),
    runner: z.string(), instrumenter: z.string(), plugin: z.string(), testRunner: z.string(), clock: z.string()
});
export type MutationModuleUrls = Readonly<z.infer<typeof mutationModulesSchema>>;

const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
export const sourceMutationModules: MutationModuleUrls = {
    adapter: new URL(`../../../../packages/stryker-runner/stryker-runner.entry-point.${extension}`, import.meta.url).href,
    core: import.meta.resolve('@stryker-mutator/core'),
    engine: new URL(`../../../../packages/engine/engine.entry-point.${extension}`, import.meta.url).href,
    config: new URL(`../../../../packages/run/config.entry-point.${extension}`, import.meta.url).href,
    runner: new URL(`../../../../packages/run/run.entry-point.${extension}`, import.meta.url).href,
    instrumenter: import.meta.resolve('@stryker-mutator/instrumenter'),
    plugin: import.meta.resolve('@stryker-mutator/api/plugin'),
    testRunner: import.meta.resolve('@stryker-mutator/api/test-runner'),
    clock: import.meta.resolve('@enormora/clock')
};

export async function withMutationProject<Value>(
    operation: (cwd: string) => Promise<Value>
): Promise<Value> {
    const previous = process.cwd();
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'overkill-mutation-evidence-')));
    try {
        process.chdir(cwd);
        await writeFile('package.json', '{"type":"module"}');
        return await operation(cwd);
    } finally {
        process.chdir(previous);
        await rm(cwd, { recursive: true, force: true });
    }
}

export async function writeMutationProfile(
    modules: MutationModuleUrls, mode: MutationMode, directory: string
): Promise<void> {
    const profile = {
        testFamily: 'microtest', files: { include: [ '*.test.mjs' ] },
        execution: { processModel: mode.processModel, scheduling: 'concurrent' },
        timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 30_000, hardMilliseconds: 60_000 }
    };
    await writeFile(join(directory, 'overkill.config.mjs'), `
import { defineConfig } from ${JSON.stringify(modules.config)};
export const config = defineConfig({ profiles: { microtest: ${JSON.stringify(profile)} } });
`);
}

export type ExpectedMutant = {
    readonly file: string;
    readonly line: number;
    readonly status: 'Killed' | 'Survived' | 'NoCoverage';
    readonly killers: readonly string[];
    readonly optimizedCases: number;
};
const subjects = [
    { file: 'disjoint.mjs', source: 'export function first() { return true; }\nexport function second() { return true; }',
        rows: [ [ 'first', 'disjoint first' ], [ 'second', 'disjoint second' ] ] },
    { file: 'shared.mjs', source: 'export function value() { return true; }',
        rows: [ [ 'value', 'shared first' ], [ 'value', 'shared second' ] ] },
    { file: 'survivor.mjs', source: 'export function value() { return true; }', rows: [] },
    { file: 'uncovered.mjs', source: 'export function value() { return true; }', rows: [] },
    { file: 'static.mjs', source: 'export const initial = true;', rows: [] },
    { file: 'hybrid.mjs', source: 'export function value() { return true; }\nexport const initial = value();', rows: [] },
    { file: 'parameter.mjs', source: 'export function value() { return true; }', rows: [] }
] as const;
export const expectedMutationManifest: readonly ExpectedMutant[] = [
    { file: 'disjoint.mjs', line: 1, status: 'Killed', killers: [ 'disjoint first' ], optimizedCases: 1 },
    { file: 'disjoint.mjs', line: 2, status: 'Killed', killers: [ 'disjoint second' ], optimizedCases: 1 },
    { file: 'shared.mjs', line: 1, status: 'Killed', killers: [ 'shared first', 'shared second' ], optimizedCases: 2 },
    { file: 'survivor.mjs', line: 1, status: 'Survived', killers: [], optimizedCases: 1 },
    { file: 'uncovered.mjs', line: 1, status: 'NoCoverage', killers: [], optimizedCases: 0 },
    { file: 'static.mjs', line: 1, status: 'Killed', killers: [ 'static' ], optimizedCases: 9 },
    { file: 'hybrid.mjs', line: 1, status: 'Killed', killers: [ 'hybrid' ], optimizedCases: 9 },
    { file: 'parameter.mjs', line: 1, status: 'Killed', killers: [ 'parameter 1', 'parameter 2' ], optimizedCases: 2 }
];

export async function writeAccuracyProject(modules: MutationModuleUrls, mode: MutationMode): Promise<void> {
    await writeMutationProfile(modules, mode, process.cwd());
    for (const subject of subjects) {
        await writeFile(subject.file, subject.source);
    }
    const assertions = subjects.flatMap(function ordinaryCases(subject) {
        return subject.rows.map(function checkedCase([ method, title ]) {
            return `check(${JSON.stringify(title)}, scope => scope.assert.equal(subjects[${JSON.stringify(subject.file)}].${method}(), true))`;
        });
    });
    await writeFile('accuracy.test.mjs', `
import { createSuite, createTestCase, createSkippedTestCase, createTable } from ${JSON.stringify(modules.engine)};
${subjects.map((subject, index) => `import * as subject${index} from './${subject.file}';`).join('\n')}
const subjects = { ${subjects.map((subject, index) => `${JSON.stringify(subject.file)}: subject${index}`).join(',')} };
const metadata = { annotations: {}, controls: {}, definitionLocations: [{kind:'unknown'}] };
const check = (title, assertion) => createTestCase({ ...metadata, title, body(scope) {
    assertion(scope); return scope.assert.collect();
} });
export const testNode = createSuite({ ...metadata, title:'repeatable mutation suite', children: [
    ${assertions.join(',\n')},
    check('covered survivor', scope => scope.assert.equal(typeof subjects['survivor.mjs'].value(), 'boolean')),
    check('static', scope => scope.assert.equal(subjects['static.mjs'].initial, true)),
    check('hybrid', scope => { scope.assert.equal(subjects['hybrid.mjs'].initial, true); scope.assert.equal(subjects['hybrid.mjs'].value(), true); }),
    createTable({ ...metadata, title:'parameters', cases: [1, 2].map(value => ({
        annotations: {}, controls: {}, title:'parameter ' + value, parameters:{value},
        body(scope) { scope.assert.equal(subjects['parameter.mjs'].value(), true); return scope.assert.collect(); }
    })) }),
    createSkippedTestCase({ ...metadata, title:'intentional skip', reason:'fixture' })
] });
`);
}

export async function writeCostProject(
    modules: MutationModuleUrls, mode: MutationMode, files: number, casesPerFile: number, directory: string
): Promise<void> {
    await writeMutationProfile(modules, mode, directory);
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    for (let file = 0; file < files; file += 1) {
        await writeFile(join(directory, `subject-${file}.mjs`), 'export function value() { return true; }');
        await writeFile(join(directory, `case-${file}.test.mjs`), `
import { createSuite, createTestCase } from ${JSON.stringify(modules.engine)};
import { value } from './subject-${file}.mjs';
export const graphIdentity = {};
const metadata = { annotations:{}, controls:{}, definitionLocations:[{kind:'unknown'}] };
export const testNode = createSuite({ ...metadata, title:'file ${file}', children:
    Array.from({length:${casesPerFile}}, (_, index) => createTestCase({ ...metadata, title:'case ' + index,
        body(scope) { scope.assert.equal(typeof value(), 'boolean'); return scope.assert.collect(); }
    })) });
`);
    }
}
