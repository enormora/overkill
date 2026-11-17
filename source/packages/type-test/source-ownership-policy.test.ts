import * as ast from 'typescript-beta/ast';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import type { TestPlan, TestBodyOrigin } from '../engine/engine.entry-point.ts';
import { observationPlan } from '../../test-support/observation-lifetime.ts';
import {
    sourceFixture,
    type SourceFixture,
    sourceSymbol,
    sourceTree,
    sourceFile,
    sourceBody,
    sourceCall,
    sourceMember,
    sourceProperty
} from '../../test-support/native-source-fixture.ts';
import { resolveBodyOrigin } from './source-ownership.ts';
import { translateNativePlan } from './native-translation.ts';
import { validateCallbackStorage } from './source-options.ts';
import { nativeReference } from './native-reference.ts';

type OwnershipFixture = SourceFixture & {
    readonly body: ast.ArrowFunction;
    readonly call: ast.CallExpression;
    readonly plan: TestPlan;
};
function positioned<Node extends ast.Node>(node: Node, start: number): Node {
    Reflect.set(node, 'pos', start);
    Reflect.set(node, 'end', 7);
    node.forEachChild(function position(child) {
        positioned(child, start);
    });
    return node;
}
function ownedCallback(
    name: string,
    options: (body: ast.ArrowFunction) => readonly ast.Expression[]
): OwnershipFixture {
    const fixture = sourceFixture();
    const body = sourceBody([]);
    const call = sourceCall(ast.factory.createIdentifier(name), options(body));
    const file = positioned(sourceFile([ ast.factory.createExpressionStatement(call) ], '/project/case.ts'), 0);
    positioned(body, 1);
    bindAuthoring(fixture, call, name);
    fixture.files.set(file.fileName, file);
    return { ...fixture, body, call, plan: ownedPlan(file) };
}
function bindAuthoring(fixture: SourceFixture, call: ast.CallExpression, name: string): void {
    const declaration = ast.factory.createFunctionDeclaration(
        undefined,
        undefined,
        ast.factory.createIdentifier(name),
        undefined,
        [],
        undefined,
        ast.factory.createBlock([])
    );
    sourceFile([ declaration ], '/project/source/authoring/test.ts');
    fixture.names.set(name, sourceSymbol(name, [ declaration ]));
    fixture.signatures.set(call, {
        declaration: {
            async resolve() {
                return declaration;
            }
        }
    });
}
function ownedPlan(file: ast.SourceFile): TestPlan {
    const original = observationPlan();
    const selected = {
        ...original.cases[0],
        bodyOrigin: {
            body() {
                throw new Error('Callback must stay unexecuted.');
            },
            location: { kind: 'known' as const, file: file.fileName, line: 1, column: 1 }
        }
    };
    return { ...original, cases: [ selected ], discoveredCases: [ selected ] };
}
function bodyOptions(body: ast.ArrowFunction): ast.ObjectLiteralExpression {
    return ast.factory.createObjectLiteralExpression([ sourceProperty('body', body) ]);
}
function origin(fixture: OwnershipFixture): TestBodyOrigin {
    const value = fixture.plan.cases[0].bodyOrigin;
    if (value === null) {
        throw new Error('Missing owned callback.');
    }
    return value;
}
export const testNode = suite('isolated callback source ownership', [
    ...[ 'test', 'withResource', 'withResources', 'withRuntime' ].map(function (name) {
        return test(`resolves positional ${name} callback without executing it`, async function (scope: TestScope) {
            const fixture = ownedCallback(name, function (body) {
                return [ ast.factory.createStringLiteral('case'), body ];
            });
            scope.assert.equal(await resolveBodyOrigin(fixture.analysis, origin(fixture)), fixture.body);
            return scope.assert.collect();
        });
    }),
    ...[ 'createTestCase', 'unknownAuthoring' ].map(function (name) {
        return test(`resolves explicit body options for ${name}`, async function (scope: TestScope) {
            const fixture = ownedCallback(name, function (body) {
                return [ bodyOptions(body) ];
            });
            scope.assert.equal(await resolveBodyOrigin(fixture.analysis, origin(fixture)), fixture.body);
            return scope.assert.collect();
        });
    }),
    test('resolves parameterized callback declarations', async function (scope: TestScope) {
        const fixture = ownedCallback('defineParameterizedTestBody', function (body) {
            return [ body ];
        });
        scope.assert.equal(await resolveBodyOrigin(fixture.analysis, origin(fixture)), fixture.body);
        return scope.assert.collect();
    }),
    test('resolves explicit table callback options', async function (scope: TestScope) {
        const fixture = ownedCallback('table', function (body) {
            return [ ast.factory.createObjectLiteralExpression([ sourceProperty('test', body) ]) ];
        });
        scope.assert.equal(await resolveBodyOrigin(fixture.analysis, origin(fixture)), fixture.body);
        return scope.assert.collect();
    }),
    test('rejects absent arguments and absent body properties', async function (scope: TestScope) {
        const empty = ownedCallback('test', function () {
            return [];
        });
        await scope.assert.rejects(async function () {
            await resolveBodyOrigin(empty.analysis, origin(empty));
        }, { message: /no arguments/u });
        const absent = ownedCallback('createTestCase', function () {
            return [ ast.factory.createObjectLiteralExpression([]) ];
        });
        await scope.assert.rejects(async function () {
            await resolveBodyOrigin(absent.analysis, origin(absent));
        }, { message: /no explicit body/u });
        return scope.assert.collect();
    }),
    test('rejects options whose later spreads can replace the callback', async function (scope: TestScope) {
        const fixture = ownedCallback('createTestCase', function (body) {
            return [ ast.factory.createObjectLiteralExpression([
                sourceProperty('body', body),
                ast.factory.createSpreadAssignment(ast.factory.createIdentifier('unknown'))
            ]) ];
        });
        await scope.assert.rejects(async function () {
            await resolveBodyOrigin(fixture.analysis, origin(fixture));
        }, { message: /potentially overriding/u });
        return scope.assert.collect();
    }),
    test('rejects options with non-object source ownership', async function (scope: TestScope) {
        const fixture = ownedCallback('createTestCase', function () {
            return [ ast.factory.createStringLiteral('options') ];
        });
        await scope.assert.rejects(async function () {
            await resolveBodyOrigin(fixture.analysis, origin(fixture));
        }, { message: /Unsupported callback options/u });
        return scope.assert.collect();
    }),
    test('leaves unbound option literals unchanged', async function (scope: TestScope) {
        const fixture = sourceFixture();
        const value = sourceTree(ast.factory.createObjectLiteralExpression([]));
        await validateCallbackStorage(fixture.analysis, value);
        scope.assert.equal(value.properties.length, 0);
        return scope.assert.collect();
    }),
    test('translates owned callback modules and deduplicates their owners', async function (scope: TestScope) {
        const fixture = ownedCallback('test', function (body) {
            return [ ast.factory.createStringLiteral('case'), body ];
        });
        const result = await translateNativePlan(fixture.analysis, {
            ...fixture.plan,
            cases: [ fixture.plan.cases[0], fixture.plan.cases[0] ]
        });
        scope.assert.equal(result.modules.length, 1);
        scope.assert.includes(result.modules[0]?.text ?? '', "from 'tstyche'");
        scope.assert.deepEqual(result.sites, []);
        return scope.assert.collect();
    }),
    test('requires ownership for executable cases and ignores skipped ones', async function (scope: TestScope) {
        const fixture = sourceFixture();
        const original = observationPlan();
        const plan = { ...original, cases: [ { ...original.cases[0], bodyOrigin: null } ] };
        await scope.assert.rejects(async function () {
            await translateNativePlan(fixture.analysis, plan);
        }, { message: /no callback source ownership/u });
        const selected = { ...plan.cases[0], execution: { kind: 'skip' as const, reason: 'unsupported' } };
        scope.assert.deepEqual(await translateNativePlan(fixture.analysis, { ...plan, cases: [ selected ] }), {
            modules: [],
            sites: []
        });
        return scope.assert.collect();
    }),
    test('retains source anchors in ownership failures', async function (scope: TestScope) {
        const fixture = ownedCallback('test', function () {
            return [];
        });
        await scope.assert.rejects(async function () {
            await translateNativePlan(fixture.analysis, fixture.plan);
        }, { message: /case.ts:1:1: Callback construction has no arguments/u });
        return scope.assert.collect();
    }),
    ...[ 'sameType', 'assignableTo', 'assignableFrom' ].map(function (name) {
        return test(`recognizes adapter-owned ${name} references`, async function (scope: TestScope) {
            const fixture = sourceFixture();
            const declaration = ast.factory.createFunctionDeclaration(
                undefined,
                undefined,
                ast.factory.createIdentifier(name),
                undefined,
                [],
                undefined,
                undefined
            );
            sourceFile([ declaration ], '/project/packages/type-test/type-test.entry-point.ts');
            fixture.names.set(name, sourceSymbol(name, [ declaration ]));
            const reference = sourceTree(sourceMember(ast.factory.createIdentifier(name), 'expressions'));
            const result = await nativeReference(fixture.analysis, reference);
            scope.assert.deepEqual(result, {
                kind: 'relation',
                matcher:
                    { sameType: 'toBe', assignableTo: 'toBeAssignableTo', assignableFrom: 'toBeAssignableFrom' }[name],
                form: 'expressions',
                negated: false,
                types: []
            });
            return scope.assert.collect();
        });
    })
]);
await runIfMain(import.meta, testNode);
