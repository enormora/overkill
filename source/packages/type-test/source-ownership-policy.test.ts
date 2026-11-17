import * as ast from 'typescript-beta/ast';
import { runIfMain } from '#test-runner';
import { ownedCallback, callbackOrigin as origin } from '../../test-support/callback-source.ts';
import { suite, test, testDouble, type TestScope } from '../test/test.entry-point.ts';
import type { TestPlan } from '../engine/engine.entry-point.ts';
import { observationPlan } from '../../test-support/observation-lifetime.ts';
import {
    sourceFixture,
    sourceSymbol,
    sourceTree,
    sourceFile,
    sourceMember,
    sourceProperty
} from '../../test-support/native-source-fixture.ts';
import { resolveBodyOrigin } from './source-ownership.ts';
import { translateNativePlan } from './native-translation.ts';
import { nativeReference } from './native-reference.ts';

function bodyOptions(body: ast.ArrowFunction): ast.ObjectLiteralExpression {
    return ast.factory.createObjectLiteralExpression([ sourceProperty('body', body) ]);
}
export const testNode = suite('isolated callback source ownership', [
    test('rejects runtime controls before translating a type-test body', async function (scope: TestScope) {
        const fixture = ownedCallback('test', function (body) {
            return [ body ];
        });
        const selected = fixture.plan.cases[0];
        await scope.assert.rejects(async function () {
            await translateNativePlan(fixture.analysis, {
                ...fixture.plan,
                cases: [ { ...selected, controls: { ...selected.controls, timeoutMilliseconds: 1 } } ]
            });
        }, { message: 'Type-test cases do not support runtime execution controls.' });
        return scope.assert.collect();
    }),
    test('retains unknown source anchors in translation failures', async function (scope: TestScope) {
        const fixture = ownedCallback('test', function (body) {
            return [ body ];
        });
        const selected = fixture.plan.cases[0];
        await scope.assert.rejects(async function () {
            await translateNativePlan(fixture.analysis, {
                ...fixture.plan,
                cases: [ { ...selected, bodyOrigin: { ...origin(fixture), location: { kind: 'unknown' } } } ]
            });
        }, { message: /at unknown source: Type-test checking requires a known callback source location/u });
        return scope.assert.collect();
    }),
    test('wraps non-error compiler failures with the original callback anchor', async function (scope: TestScope) {
        const fixture = ownedCallback('test', function (body) {
            return [ body ];
        });
        const checker = { ...fixture.analysis.checker, getResolvedSignature: testDouble.rejects(42) };
        await scope.assert.rejects(async function () {
            await translateNativePlan({ ...fixture.analysis, checker }, fixture.plan);
        }, { message: /case.ts:1:1: Unknown callback source./u });
        return scope.assert.collect();
    }),
    ...[ 'test', 'withResource', 'withResources', 'withRuntime' ].map(function (name) {
        return test(`resolves positional ${name} callback without executing it`, async function (scope: TestScope) {
            const fixture = ownedCallback(name, function (body) {
                return [ ast.factory.createStringLiteral('case', ast.TokenFlags.None), body ];
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
            return [ ast.factory.createStringLiteral('options', ast.TokenFlags.None) ];
        });
        await scope.assert.rejects(async function () {
            await resolveBodyOrigin(fixture.analysis, origin(fixture));
        }, { message: /Unsupported callback options/u });
        return scope.assert.collect();
    }),
    test('translates owned callback modules and deduplicates their owners', async function (scope: TestScope) {
        const fixture = ownedCallback('test', function (body) {
            return [ ast.factory.createStringLiteral('case', ast.TokenFlags.None), body ];
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
        const plan: TestPlan = { ...original, cases: [ { ...original.cases[0], bodyOrigin: null } ] };
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
    ...([ 'sameType', 'assignableTo', 'assignableFrom' ] as const).map(function (name) {
        return test(`recognizes adapter-owned ${name} references`, async function (scope: TestScope) {
            const fixture = sourceFixture();
            const declaration = ast.factory.createFunctionDeclaration(
                undefined,
                undefined,
                ast.factory.createIdentifier(name),
                undefined,
                []
            );
            sourceFile([ declaration ], '/project/packages/type-test/type-test.entry-point.ts');
            fixture.bindName(name, sourceSymbol(name, [ declaration ]));
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
