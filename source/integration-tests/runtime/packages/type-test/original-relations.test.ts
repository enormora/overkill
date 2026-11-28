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
    'GenericObjectReturn',
    'GenericArrayReturn',
    'NestedGenericReturn',
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
    'MappedOptional',
    'GenericNominalReturn'
];

const fixtureSource = `${relationSource}
export type GenericObjectReturnActual = <T>() => { value: T };
export type GenericObjectReturnExpected = <U>() => { value: U };
export type GenericArrayReturnActual = <T>() => T[];
export type GenericArrayReturnExpected = <U>() => U[];
export type NestedGenericReturnActual = <T>() => <U extends T>(value: U) => { value: T };
export type NestedGenericReturnExpected = <A>() => <B extends A>(value: B) => { value: A };
export type GenericNominalReturnActual = <T>() => { value: T; identity: First };
export type GenericNominalReturnExpected = <U>() => { value: U; identity: Second };
export type LibraryMapActual = Map<string, number>;
export type LibraryMapExpected = ReadonlyMap<string, number>;
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
            types.set(statement.name.text, await project.checker.getTypeFromTypeNode(statement.type));
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
        return check.annotated(name).deepEqual(await compareRelation(analysis, 'equal', actual, expected), {
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
        [ 'AnyUnknown', 'NeverString', 'Literal', 'LibraryMap' ].map(async function compareDirections(name) {
            const [ source, target ] = operands(types, name);
            return check.annotated(name).deepEqual(await compareRelation(analysis, 'assignableTo', source, target), {
                kind: 'established',
                holds: true
            });
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
        const unsupported = await compareRelation(analysis, 'equal', actual, expected);
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
    scope.assert(types.equal<T extends string ? T : never, T extends number ? T : never>());
    return scope.assert.collect();
}
function negatedSymbolic<T>(scope: engine.TestScope) {
    bodyCalls++;
    scope.assert(types.notEqual<T extends string ? T : never, T extends number ? T : never>());
    return scope.assert.collect();
}
const nodes=[test('symbolic',symbolic),test('negated symbolic',negatedSymbolic)];
`;

const staticBodyCases = `
function generic<T extends string>() {
    return test('generic source',scope=>{
        bodyCalls++;scope.assert(types.equal<T,'literal'>());return scope.assert.collect();
    });
}
const nodes=[generic<'literal'>(),table({title:'static rows',cases:[1,2],test:scope=>{
    bodyCalls++;scope.assert(types.equal<typeof scope.parameters,1>());return scope.assert.collect();
}})];
`;

const inferredCases = `
function identity<T>(value:T):T { return value; }
class Box<T> { readonly value:T; constructor(value:T) { this.value=value; } }
function contextual<T, R>(value:T, select:(value:T)=>R):R { return select(value); }
function wideFirst(value:string|number):'wide';
function wideFirst(value:string):'narrow';
function wideFirst(value:string|number):'wide'|'narrow' { return 'wide'; }
function narrowFirst(value:string):'narrow';
function narrowFirst(value:string|number):'wide';
function narrowFirst(value:string|number):'wide'|'narrow' { return 'narrow'; }
export class Nominal { private readonly identity = 1; }
class Other { private readonly identity = 1; }
const nodes=[suite('composition',[
    test('authored inference',scope=>{
        bodyCalls++;
        const result = identity('literal' as const);
        scope.assert(types.equal<typeof result,'literal'>());
        const box = new Box(42 as const);
        scope.assert(types.equal<typeof box,Box<42>>());
        const name = contextual({name:'value'},value=>value.name);
        scope.assert(types.equal<typeof name,string>());
        return scope.assert.collect();
    }),
    test('overload order',scope=>{
        bodyCalls++;
        const wide = wideFirst('text');
        scope.assert(types.equal<typeof wide,'wide'>());
        const narrow = narrowFirst('text');
        scope.assert(types.equal<typeof narrow,'narrow'>());
        scope.assert(types.notEqual<typeof wideFirst,typeof narrowFirst>());
        return scope.assert.collect();
    }),
    test('nominal identity',scope=>{
        bodyCalls++;
        scope.assert(types.equal<Nominal,import('./cases.ts').Nominal>());
        scope.assert(types.notEqual<Nominal,Other>());
        return scope.assert.collect();
    }),
    test('assertion in a skipped branch',scope=>{
        bodyCalls++;
        if(false)scope.assert(types.equal<string,number>());
        return scope.assert.collect();
    })
])];
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
    test('checks authored inference, overloads and nominal identity without executing bodies', async function (scope) {
        const result = await runNativeProject(scope.cleanup, inferredCases, null);
        scope.assert.deepEqual(result.completions, [
            { title: 'authored inference', verdict: 'pass' },
            { title: 'overload order', verdict: 'pass' },
            { title: 'nominal identity', verdict: 'pass' },
            { title: 'assertion in a skipped branch', verdict: 'fail' }
        ], { message: [ ...result.errors, ...result.diagnostics ].join('\n') });
        scope.assert.equal(result.bodyCalls, 0);
        scope.assert.deepEqual(result.errors, []);
        return scope.assert.collect();
    }),
    test(
        'treats nested recovery types as invalid evidence in both directions and under negation',
        async function (scope) {
            const result = await runNativeProject(
                scope.cleanup,
                `const nodes = [
test('assignable to', scope => {
    // @ts-expect-error fixture intentionally refers to a missing type
    scope.assert(types.assignableTo<{ item: Missing }, { item: string }>());
    return scope.assert.collect();
}),
test('assignable from', scope => {
    // @ts-expect-error fixture intentionally refers to a missing type
    scope.assert(types.assignableTo<{ item: Missing[] }, { item: string[] }>());
    return scope.assert.collect();
}),
test('negated', scope => {
    // @ts-expect-error fixture intentionally refers to a missing type
    scope.assert(types.notAssignableTo<{ item: Missing }, { item: string }>());
    return scope.assert.collect();
}),
test('equality', scope => {
    // @ts-expect-error fixture intentionally refers to a missing type
    scope.assert(types.equal<{ item: Missing }, { item: any }>());
    return scope.assert.collect();
}),
test('erased missing type', scope => {
    // @ts-expect-error the union would otherwise erase the missing type
    scope.assert(types.assignableTo<string | Missing | any, string>());
    return scope.assert.collect();
}),
test('explicit any', scope => {
    scope.assert(types.assignableTo<{ item: any }, { item: string }>());
    return scope.assert.collect();
})
];`,
                null
            );
            scope.assert.deepEqual(result.completions, [
                { title: 'assignable to', verdict: 'inconclusive' },
                { title: 'assignable from', verdict: 'inconclusive' },
                { title: 'negated', verdict: 'inconclusive' },
                { title: 'equality', verdict: 'inconclusive' },
                { title: 'erased missing type', verdict: 'inconclusive' },
                { title: 'explicit any', verdict: 'pass' }
            ]);
            scope.assert.includes(result.errors.join('\n'), 'Recovery types cannot establish a type relation.');
            return scope.assert.collect();
        }
    ),
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
