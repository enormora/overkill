import { type TestNode, table, suite, test } from '@overkill-dev/test';

import * as ast from 'typescript-beta/ast';

import { ownedCallback, callbackOrigin as origin } from '../../../../test-support/callback-source.ts';
import { testDouble } from '../../../../packages/test/test.entry-point.ts';
import type { TestPlan } from '../../../../packages/engine/engine.entry-point.ts';
import { observationPlan } from '../../../../test-support/observation-lifetime.ts';
import {
    sourceFixture,
    sourceSymbol,
    sourceTree,
    sourceFile,
    sourceMember,
    sourceProperty
} from '../../../../test-support/native-source-fixture.ts';
import { resolveBodyOrigin } from '../../../../packages/type-test/source-ownership.ts';
import { collectOriginalAssertions } from '../../../../packages/type-test/original-assertions.ts';
import { nativeReference } from '../../../../packages/type-test/native-reference.ts';

function bodyOptions(body: ast.ArrowFunction): ast.ObjectLiteralExpression {
    return ast.factory.createObjectLiteralExpression([ sourceProperty('body', body) ]);
}
export const testNode: TestNode = suite('isolated callback source ownership', [
    test('rejects runtime controls before translating a type-test body', async function (scope) {
        const fixture = ownedCallback('test', function (body) {
            return [ body ];
        });
        const selected = fixture.plan.cases[0];
        await scope.assert.rejects(async function () {
            await collectOriginalAssertions(fixture.analysis, {
                ...fixture.plan,
                cases: [ { ...selected, controls: { ...selected.controls, timeoutMilliseconds: 1 } } ]
            });
        }, { message: 'Type-test cases do not support runtime execution controls.' });
        return scope.assert.collect();
    }),
    test('retains unknown source anchors in translation failures', async function (scope) {
        const fixture = ownedCallback('test', function (body) {
            return [ body ];
        });
        const selected = fixture.plan.cases[0];
        const result = await collectOriginalAssertions(fixture.analysis, {
            ...fixture.plan,
            cases: [ { ...selected, bodyOrigin: { ...origin(fixture), location: { kind: 'unknown' } } } ]
        });
        scope.assert.equal(result.issues.length, 1);
        scope.assert.deepEqual<unknown, unknown>(result.issues[0]?.owner, selected.workId);
        scope.assert.includes(
            result.issues[0]?.reason ?? '',
            'at unknown source: Type-test checking requires a known callback source location'
        );
        return scope.assert.collect();
    }),
    test('propagates unexpected compiler failures', async function (scope) {
        const fixture = ownedCallback('test', function (body) {
            return [ body ];
        });
        const checker = {
            ...fixture.analysis.checker,
            getResolvedSignature: testDouble.rejects(new Error('Compiler unavailable'))
        };
        await scope.assert.rejects(async function () {
            await collectOriginalAssertions({ ...fixture.analysis, checker }, fixture.plan);
        }, { message: 'Compiler unavailable' });
        return scope.assert.collect();
    }),
    table({
        title: 'resolves positional callbacks without execution',
        cases: [ 'test', 'withResource', 'withResources', 'withRuntime' ],
        caseTitle(name) {
            return name;
        },
        async test(scope) {
            const name = scope.parameters;

            const fixture = ownedCallback(name, function (body) {
                return [ ast.factory.createStringLiteral('case', ast.TokenFlags.None), body ];
            });
            scope.assert.equal(await resolveBodyOrigin(fixture.analysis, origin(fixture)), fixture.body);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'resolves explicit body options',
        cases: [ 'createTestCase', 'unknownAuthoring' ],
        caseTitle(name) {
            return name;
        },
        async test(scope) {
            const name = scope.parameters;

            const fixture = ownedCallback(name, function (body) {
                return [ bodyOptions(body) ];
            });
            scope.assert.equal(await resolveBodyOrigin(fixture.analysis, origin(fixture)), fixture.body);
            return scope.assert.collect();
        }
    }),
    test('resolves parameterized callback declarations', async function (scope) {
        const fixture = ownedCallback('defineParameterizedTestBody', function (body) {
            return [ body ];
        });
        scope.assert.equal(await resolveBodyOrigin(fixture.analysis, origin(fixture)), fixture.body);
        return scope.assert.collect();
    }),
    test('resolves explicit table callback options', async function (scope) {
        const fixture = ownedCallback('table', function (body) {
            return [ ast.factory.createObjectLiteralExpression([ sourceProperty('test', body) ]) ];
        });
        scope.assert.equal(await resolveBodyOrigin(fixture.analysis, origin(fixture)), fixture.body);
        return scope.assert.collect();
    }),
    test('rejects absent arguments and absent body properties', async function (scope) {
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
    test('rejects options whose later spreads can replace the callback', async function (scope) {
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
    test('rejects options with non-object source ownership', async function (scope) {
        const fixture = ownedCallback('createTestCase', function () {
            return [ ast.factory.createStringLiteral('options', ast.TokenFlags.None) ];
        });
        await scope.assert.rejects(async function () {
            await resolveBodyOrigin(fixture.analysis, origin(fixture));
        }, { message: /Unsupported callback options/u });
        return scope.assert.collect();
    }),
    test('translates owned callback modules and deduplicates their owners', async function (scope) {
        const fixture = ownedCallback('test', function (body) {
            return [ ast.factory.createStringLiteral('case', ast.TokenFlags.None), body ];
        });
        const result = await collectOriginalAssertions(fixture.analysis, {
            ...fixture.plan,
            cases: [ fixture.plan.cases[0], fixture.plan.cases[0] ]
        });
        scope.assert.equal(result.modules.length, 1);
        scope.assert.equal(result.modules[0]?.originalText, fixture.body.getSourceFile().text);
        scope.assert.deepEqual(result.sites, []);
        return scope.assert.collect();
    }),
    test('requires ownership for executable cases and ignores skipped ones', async function (scope) {
        const fixture = sourceFixture();
        const original = observationPlan();
        const plan: TestPlan = { ...original, cases: [ { ...original.cases[0], bodyOrigin: null } ] };
        const result = await collectOriginalAssertions(fixture.analysis, plan);
        scope.assert.partialDeepEqual<unknown, unknown>(result.issues, [ {
            owner: plan.cases[0].workId,
            reason: 'Selected type-test case has no callback source ownership.'
        } ]);
        const selected = { ...plan.cases[0], execution: { kind: 'skip' as const, reason: 'unsupported' } };
        scope.assert.deepEqual(await collectOriginalAssertions(fixture.analysis, { ...plan, cases: [ selected ] }), {
            modules: [],
            sites: [],
            issues: []
        });
        return scope.assert.collect();
    }),
    test('retains source anchors in ownership failures', async function (scope) {
        const fixture = ownedCallback('test', function () {
            return [];
        });
        const result = await collectOriginalAssertions(fixture.analysis, fixture.plan);
        scope.assert.equal(result.issues.length, 1);
        scope.assert.deepEqual<unknown, unknown>(result.issues[0]?.owner, fixture.plan.cases[0].workId);
        scope.assert.includes(result.issues[0]?.reason ?? '', 'case.ts:1:1: Callback construction has no arguments');
        return scope.assert.collect();
    }),
    table({
        title: 'recognizes adapter-owned references',
        cases: [ 'sameType', 'assignableTo', 'assignableFrom' ] as const,
        caseTitle(name) {
            return name;
        },
        async test(scope) {
            const name = scope.parameters;

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
                relation: name,
                form: 'expressions',
                negated: false,
                types: []
            });
            return scope.assert.collect();
        }
    })
]);
