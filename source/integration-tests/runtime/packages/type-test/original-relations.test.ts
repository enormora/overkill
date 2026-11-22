import { mkdir, mkdtemp, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

import { type TestScope, suite, test } from '@overkill-dev/test';

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

async function fixtureDirectory(cleanup: TestScope['cleanup']): Promise<string> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp(join(process.cwd(), 'target/original-relations-'));
    cleanup(async function removeFixture() {
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
    cleanup: TestScope['cleanup'],
    signal: AbortSignal
): Promise<{ readonly project: FrozenProject; readonly directory: string; }> {
    const directory = await fixtureDirectory(cleanup);
    await writeFixture(directory);
    const project = await loadProject(
        join(directory, 'tsconfig.json'),
        {
            kind: 'package',
            specifier: 'typescript-beta',
            version: '7.1.0-beta'
        },
        process.cwd(),
        signal
    );
    cleanup(async function disposeCompiler() {
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

const equalityChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    analysis: TypeAnalysis,
    types: ReadonlyMap<string, Type>
): Promise<CompositeAssertionReturn<'assert'>> {
    const checks = await Promise.all([ ...equal, ...unequal ].map(async function compareOriginalTypes(name) {
        const [ actual, expected ] = operands(types, name);
        return check.annotated(name).deepEqual(await compareRelation(analysis, 'sameType', actual, expected), {
            kind: 'established',
            holds: equal.has(name)
        });
    }));
    const [ first, ...remaining ] = checks;
    if (first === undefined) {
        throw new Error('Expected original type comparisons.');
    }
    return check.group([ first, ...remaining ]);
};
const assignabilityChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    analysis: TypeAnalysis,
    types: ReadonlyMap<string, Type>
): Promise<CompositeAssertionReturn<'assert'>> {
    const checks = await Promise.all(
        [ 'AnyUnknown', 'NeverString', 'Literal' ].map(async function compareDirections(name) {
            const [ source, target ] = operands(types, name);
            const annotated = check.annotated(name);
            return annotated.group([
                annotated.deepEqual(await compareRelation(analysis, 'assignableTo', source, target), {
                    kind: 'established',
                    holds: true
                }),
                annotated.deepEqual(await compareRelation(analysis, 'assignableFrom', target, source), {
                    kind: 'established',
                    holds: true
                })
            ]);
        })
    );
    const [ first, ...remaining ] = checks;
    if (first === undefined) {
        throw new Error('Expected assignability comparisons.');
    }
    return check.group([ first, ...remaining ]);
};
const assertRelations = defineCompositeAssertion({
    name: 'relations',
    async assert(check, analysis: TypeAnalysis, types: ReadonlyMap<string, Type>) {
        const initialChecks = check.group([
            await equalityChecks(check.annotated('equality'), analysis, types),
            await assignabilityChecks(check.annotated('assignability'), analysis, types)
        ]);
        const [ actual, expected ] = operands(types, 'Symbolic');
        const unsupported = await compareRelation(analysis, 'sameType', actual, expected);
        return check.group([ initialChecks, check.equal(unsupported.kind, 'inconclusive') ]);
    }
});

const assertOriginalFiles = defineCompositeAssertion({
    name: 'original files',
    async assert(check, directory: string) {
        const entries = await readdir(directory);
        return check.group([
            check.equal(await readFile(join(directory, 'relations.ts'), 'utf8'), fixtureSource),
            check.deepEqual(
                entries.toSorted(function compareNames(left, right) {
                    return left.localeCompare(right);
                }),
                [
                    'dependency.ts',
                    'relations.ts',
                    'tsconfig.json'
                ]
            )
        ]);
    }
});

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

export const testNode = suite('original-source relations', [
    test('implements the documented equality rules in the original project', async function (scope) {
        const { project, directory } = await originalProject(scope.cleanup, scope.signal);
        const analysis = typeAnalysis(project);
        const types = await originalTypes(project, directory);
        scope.assert.deepEqual(await project.program.getSemanticDiagnostics(), []);
        await scope.assert(assertRelations, analysis, types);
        await scope.assert(assertOriginalFiles, directory);
        return scope.assert.collect();
    }),
    test('checks generic and table bodies under their authored static types', async function (scope) {
        const result = await runNativeProject(scope.cleanup, staticBodyCases, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.failed, 2);
        scope.assert.equal(result.summary.inconclusive, 1);
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.equal(result.bodyCalls, 0);
        return scope.assert.collect();
    }),
    test('keeps unsupported symbolic evidence inconclusive under negation', async function (scope) {
        const result = await runNativeProject(scope.cleanup, unsupportedCases, null);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.inconclusive, 2);
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.equal(result.summary.failed, 0);
        scope.assert.equal(result.bodyCalls, 0);
        scope.assert.includes(result.errors.join('\n'), 'Public compiler evidence');
        return scope.assert.collect();
    })
]);
