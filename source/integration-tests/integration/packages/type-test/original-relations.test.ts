import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';
import { mkdir, mkdtemp, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Type } from 'typescript-beta/async';
import { runNativeProject } from '../../../../test-support/native-type-project.ts';
import { relationSource } from '../../../../test-support/type-test-relation-project.ts';
import {
    loadProject,
    disposeProject,
    typeAnalysis,
    type FrozenProject
} from '../../../../packages/type-test/frozen-project.ts';
import { compareRelation } from '../../../../packages/type-test/type-relations.ts';
import type { TypeAnalysis } from '../../../../packages/type-test/source-analysis-port.ts';

const equal = new Set([
    'Any',
    'Never',
    'Unknown',
    'Union',
    'Intersection',
    'Parameter',
    'Generic',
    'Recursive',
    'Imported',
    'Self',
    'Inference',
    'MappedEquivalent',
    'IndexOrder'
]);
const unequal = [
    'AnyUnknown',
    'NeverString',
    'Literal',
    'Optional',
    'Readonly',
    'Nominal',
    'Protected',
    'Symbol',
    'This',
    'Rest',
    'OptionalParameter',
    'Constraint',
    'Default',
    'Const',
    'NoInfer',
    'Overload',
    'MappedReadonly',
    'MappedOptional'
];

const fixtureSource = `${relationSource}
export type MappedEquivalentActual = Readonly<{ value: string }>;
export type MappedEquivalentExpected = { readonly value: string };
export type MappedReadonlyActual = Readonly<{ value: string }>;
export type MappedReadonlyExpected = { value: string };
export type MappedOptionalActual = Partial<{ value: string }>;
export type MappedOptionalExpected = { value: string | undefined };
export type IndexOrderActual = { [key: string]: string; [key: number]: 'number' };
export type IndexOrderExpected = { [key: number]: 'number'; [key: string]: string };
`;

async function fixtureDirectory(scope: TestScope): Promise<string> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp(join(process.cwd(), 'target/original-relations-'));
    scope.cleanup(async function removeFixture() {
        await rm(directory, { recursive: true, force: true });
    });
    return directory;
}

async function writeFixture(directory: string): Promise<void> {
    const config = {
        compilerOptions: {
            strict: true,
            skipLibCheck: true,
            noEmit: true,
            target: 'ESNext',
            lib: [ 'ESNext' ],
            module: 'NodeNext',
            moduleResolution: 'NodeNext'
        },
        files: [ 'relations.ts' ]
    };
    await Promise.all([
        writeFile(join(directory, 'relations.ts'), fixtureSource),
        writeFile(join(directory, 'dependency.ts'), 'export type Value = { readonly value: string };'),
        writeFile(join(directory, 'tsconfig.json'), JSON.stringify(config))
    ]);
}

async function originalProject(
    scope: TestScope
): Promise<{ readonly project: FrozenProject; readonly directory: string; }> {
    const directory = await fixtureDirectory(scope);
    await writeFixture(directory);
    const project = await loadProject(join(directory, 'tsconfig.json'), {
        kind: 'package',
        specifier: 'typescript-beta',
        version: '7.1.0-beta'
    }, process.cwd());
    scope.cleanup(async function disposeCompiler() {
        await disposeProject(project);
    });
    return { project, directory };
}

async function originalTypes(project: FrozenProject, directory: string): Promise<ReadonlyMap<string, Type>> {
    const source = await project.program.getSourceFile(join(directory, 'relations.ts'));
    if (source === undefined) {
        throw new Error('Missing original fixture.');
    }
    const types = new Map<string, Type>();
    for (const statement of source.statements) {
        if (project.compiler.syntax.isTypeAliasDeclaration(statement)) {
            types.set(statement.name.text, await project.configured.checker.getTypeFromTypeNode(statement.type));
        }
    }
    return types;
}

function operands(types: ReadonlyMap<string, Type>, name: string): readonly [Type, Type] {
    const actual = types.get(`${name}Actual`);
    const expected = types.get(`${name}Expected`);
    if (actual === undefined || expected === undefined) {
        throw new Error(`Missing operands for ${name}`);
    }
    return [ actual, expected ];
}

async function assertEquality(
    scope: TestScope,
    analysis: TypeAnalysis,
    types: ReadonlyMap<string, Type>
): Promise<void> {
    for (const name of [ ...equal, ...unequal ]) {
        const [ actual, expected ] = operands(types, name);
        scope.assert.deepEqual(await compareRelation(analysis, 'sameType', actual, expected), {
            kind: 'established',
            holds: equal.has(name)
        }, { message: name });
    }
}

async function assertAssignability(
    scope: TestScope,
    analysis: TypeAnalysis,
    types: ReadonlyMap<string, Type>
): Promise<void> {
    for (const name of [ 'AnyUnknown', 'NeverString', 'Literal' ]) {
        const [ source, target ] = operands(types, name);
        scope.assert.deepEqual(await compareRelation(analysis, 'assignableTo', source, target), {
            kind: 'established',
            holds: true
        }, { message: name });
        scope.assert.deepEqual(await compareRelation(analysis, 'assignableFrom', target, source), {
            kind: 'established',
            holds: true
        }, { message: name });
    }
}

async function assertRelations(
    scope: TestScope,
    analysis: TypeAnalysis,
    types: ReadonlyMap<string, Type>
): Promise<void> {
    await assertEquality(scope, analysis, types);
    await assertAssignability(scope, analysis, types);
    const [ actual, expected ] = operands(types, 'Symbolic');
    const unsupported = await compareRelation(analysis, 'sameType', actual, expected);
    scope.assert.equal(unsupported.kind, 'inconclusive');
}

async function assertOriginalFiles(scope: TestScope, directory: string): Promise<void> {
    const entries = await readdir(directory);
    scope.assert.equal(await readFile(join(directory, 'relations.ts'), 'utf8'), fixtureSource);
    scope.assert.deepEqual(
        entries.toSorted(function compareNames(left, right) {
            return left.localeCompare(right);
        }),
        [
            'dependency.ts',
            'relations.ts',
            'tsconfig.json'
        ]
    );
}

const unsupportedCases = `
function symbolic<T>(scope: engine.TestScope) {
    bodyCalls++;
    scope.assert(same<T extends string ? T : never, T extends number ? T : never>());
    return scope.assert.collect();
}
function negatedSymbolic<T>(scope: engine.TestScope) {
    bodyCalls++;
    scope.assert(same.not<T extends string ? T : never, T extends number ? T : never>());
    return scope.assert.collect();
}
const nodes=[test('symbolic',symbolic),test('negated symbolic',negatedSymbolic)];
`;

const staticBodyCases = `
function generic<T extends string>() {
    return test('generic source',scope=>{
        bodyCalls++;scope.assert(same<T,'literal'>());return scope.assert.collect();
    });
}
const nodes=[generic<'literal'>(),table({title:'static rows',cases:[1,2],test:scope=>{
    bodyCalls++;scope.assert(same<typeof scope.parameters,1>());return scope.assert.collect();
}})];
`;

export const testNode: TestNode = suite('original-source relations', [
    test('implements the documented equality rules in the original project', async function (scope) {
        const { project, directory } = await originalProject(scope);
        const analysis = typeAnalysis(project);
        const types = await originalTypes(project, directory);
        scope.assert.deepEqual(await project.program.getSemanticDiagnostics(), []);
        await assertRelations(scope, analysis, types);
        await assertOriginalFiles(scope, directory);
        return scope.assert.collect();
    }),
    test('checks generic and table bodies under their authored static types', async function (scope) {
        const result = await runNativeProject(scope, staticBodyCases, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.failed, 2);
        scope.assert.equal(result.summary.inconclusive, 1);
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('keeps unsupported symbolic evidence inconclusive under negation', async function (scope) {
        const result = await runNativeProject(scope, unsupportedCases, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.inconclusive, 2);
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.equal(result.summary.failed, 0);
        scope.assert.equal(result.bodyCalls, 0);
        scope.assert.includes(result.errors.join('\n'), 'Public compiler evidence');
        return scope.assert.collect();
    })
]);
