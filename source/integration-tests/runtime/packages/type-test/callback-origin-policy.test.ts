import { table, suite, test } from '@overkill-dev/test';

import * as ast from 'typescript-beta/ast';

import {
    ownedCallback,
    callbackOrigin,
    attachCallbackSource,
    bindAuthoringCall
} from '../../../../test-support/callback-source.ts';
import {
    sourceConstant,
    sourceSymbol,
    sourceProperty,
    sourceBody,
    sourceCall,
    sourceMember
} from '../../../../test-support/native-source-fixture.ts';
import { resolveBodyOrigin } from '../../../../packages/type-test/source-ownership.ts';

function positional(body: ast.Expression): readonly ast.Expression[] {
    return [ ast.factory.createStringLiteral('case', ast.TokenFlags.None), body ];
}
function tableOptions(cases: ast.Expression): readonly ast.Expression[] {
    return [ ast.factory.createObjectLiteralExpression([ sourceProperty('cases', cases) ]) ];
}
export const testNode = suite('callback origin boundaries', [
    test('follows immutable callback aliases to their original body', async function (scope) {
        const fixture = ownedCallback('test', function () {
            return positional(ast.factory.createIdentifier('callback'));
        });
        const statement = sourceConstant('callback', fixture.body, false);
        attachCallbackSource(fixture, [ statement ]);
        fixture.bindName('callback', sourceSymbol('callback', statement.declarationList.declarations));
        scope.assert.equal(await resolveBodyOrigin(fixture.analysis, callbackOrigin(fixture)), fixture.body);
        return scope.assert.collect();
    }),
    test('rejects cyclic callback aliases', async function (scope) {
        const fixture = ownedCallback('test', function () {
            return positional(ast.factory.createIdentifier('callback'));
        });
        const statement = sourceConstant('callback', ast.factory.createIdentifier('callback'), false);
        attachCallbackSource(fixture, [ statement ]);
        fixture.bindName('callback', sourceSymbol('callback', statement.declarationList.declarations));
        await scope.assert.rejects(async function () {
            return resolveBodyOrigin(fixture.analysis, callbackOrigin(fixture));
        }, { message: /Cyclic callback source ownership/u });
        return scope.assert.collect();
    }),
    test('rejects callbacks without declaration evidence', async function (scope) {
        const fixture = ownedCallback('test', function () {
            return positional(ast.factory.createIdentifier('unknown'));
        });
        await scope.assert.rejects(async function () {
            return resolveBodyOrigin(fixture.analysis, callbackOrigin(fixture));
        }, { message: /ambiguous callback source ownership/u });
        return scope.assert.collect();
    }),
    test('resolves explicit callback methods', async function (scope) {
        const body = sourceBody([]);
        const method = ast.factory.createMethodDeclaration(
            undefined,
            undefined,
            ast.factory.createIdentifier('body'),
            undefined,
            undefined,
            body.parameters,
            undefined,
            ast.factory.createBlock([])
        );
        const fixture = ownedCallback('createTestCase', function () {
            return [ ast.factory.createObjectLiteralExpression([ method ]) ];
        });
        scope.assert.equal(await resolveBodyOrigin(fixture.analysis, callbackOrigin(fixture)), method);
        return scope.assert.collect();
    }),
    test('rejects callback getters without evaluating them', async function (scope) {
        const getter = ast.factory.createGetAccessorDeclaration(
            undefined,
            ast.factory.createIdentifier('body'),
            undefined,
            [],
            undefined,
            ast.factory.createBlock([])
        );
        const fixture = ownedCallback('createTestCase', function () {
            return [ ast.factory.createObjectLiteralExpression([ getter ]) ];
        });
        await scope.assert.rejects(async function () {
            return resolveBodyOrigin(fixture.analysis, callbackOrigin(fixture));
        }, { message: /Unsupported callback property source/u });
        return scope.assert.collect();
    }),
    test('resolves string-named callback properties', async function (scope) {
        const fixture = ownedCallback('createTestCase', function (body) {
            return [ ast.factory.createObjectLiteralExpression([
                ast.factory.createPropertyAssignment(
                    undefined,
                    ast.factory.createStringLiteral('body', ast.TokenFlags.None),
                    undefined,
                    ast.factory.createKeywordTypeNode(ast.SyntaxKind.UnknownKeyword),
                    body
                )
            ]) ];
        });
        scope.assert.equal(await resolveBodyOrigin(fixture.analysis, callbackOrigin(fixture)), fixture.body);
        return scope.assert.collect();
    }),
    test('rejects computed properties that may replace a callback', async function (scope) {
        const fixture = ownedCallback('createTestCase', function (body) {
            return [ ast.factory.createObjectLiteralExpression([
                sourceProperty('body', body),
                ast.factory.createPropertyAssignment(
                    undefined,
                    ast.factory.createComputedPropertyName(ast.factory.createIdentifier('key')),
                    undefined,
                    ast.factory.createKeywordTypeNode(ast.SyntaxKind.UnknownKeyword),
                    body
                )
            ]) ];
        });
        await scope.assert.rejects(async function () {
            return resolveBodyOrigin(fixture.analysis, callbackOrigin(fixture));
        }, { message: /potentially overriding property/u });
        return scope.assert.collect();
    }),
    test('resolves the selected low-level table callback', async function (scope) {
        const fixture = ownedCallback('createTable', function (body) {
            return tableOptions(
                ast.factory.createArrayLiteralExpression([ ast
                    .factory
                    .createObjectLiteralExpression([ sourceProperty('body', body) ]) ])
            );
        });
        scope.assert.equal(
            await resolveBodyOrigin(fixture.analysis, { ...callbackOrigin(fixture), tableIndex: 0, forwarded: null }),
            fixture.body
        );
        return scope.assert.collect();
    }),
    test('rejects low-level table callback indexes without source rows', async function (scope) {
        const fixture = ownedCallback('createTable', function () {
            return tableOptions(ast.factory.createArrayLiteralExpression([]));
        });
        await scope.assert.rejects(async function () {
            return resolveBodyOrigin(fixture.analysis, { ...callbackOrigin(fixture), tableIndex: 1, forwarded: null });
        }, { message: /Table case source index is missing/u });
        return scope.assert.collect();
    }),
    test('rejects spread table rows with ambiguous ownership', async function (scope) {
        const fixture = ownedCallback('createTable', function () {
            return tableOptions(
                ast.factory.createArrayLiteralExpression([ ast
                    .factory
                    .createSpreadElement(ast.factory.createIdentifier('rows')) ])
            );
        });
        await scope.assert.rejects(async function () {
            return resolveBodyOrigin(fixture.analysis, { ...callbackOrigin(fixture), tableIndex: 0, forwarded: null });
        }, { message: /table case spreads have ambiguous/u });
        return scope.assert.collect();
    }),
    test('rejects table cases without a static array source', async function (scope) {
        const fixture = ownedCallback('createTable', function () {
            return tableOptions(ast.factory.createStringLiteral('rows', ast.TokenFlags.None));
        });
        await scope.assert.rejects(async function () {
            return resolveBodyOrigin(fixture.analysis, { ...callbackOrigin(fixture), tableIndex: 0, forwarded: null });
        }, { message: /table cases require static source ownership/u });
        return scope.assert.collect();
    }),
    test('prefers known forwarded callback origins', async function (scope) {
        const fixture = ownedCallback('test', positional);
        scope.assert.equal(
            await resolveBodyOrigin(fixture.analysis, {
                ...callbackOrigin(fixture),
                location: { kind: 'unknown' },
                tableIndex: 0,
                forwarded: callbackOrigin(fixture)
            }),
            fixture.body
        );
        return scope.assert.collect();
    }),
    test('retains table origins when forwarded locations are unknown', async function (scope) {
        const fixture = ownedCallback('createTable', function (body) {
            return tableOptions(
                ast.factory.createArrayLiteralExpression([ ast
                    .factory
                    .createObjectLiteralExpression([ sourceProperty('body', body) ]) ])
            );
        });
        const origin = callbackOrigin(fixture);
        scope.assert.equal(
            await resolveBodyOrigin(fixture.analysis, {
                ...origin,
                tableIndex: 0,
                forwarded: { ...origin, location: { kind: 'unknown' } }
            }),
            fixture.body
        );
        return scope.assert.collect();
    }),
    table({
        title: 'rejects incomplete callback locations',
        cases: [ { description: 'unknown location', input: { kind: 'unknown' } }, {
            description: 'missing line',
            input: { kind: 'known', file: '/project/case.ts', line: null, column: 1 }
        }, {
            description: 'missing column',
            input: {
                kind: 'known',
                file: '/project/case.ts',
                line: 1,
                column: null
            }
        } ] as const,
        caseTitle({ description }) {
            return description;
        },
        async test(scope) {
            const location = scope.parameters.input;

            const fixture = ownedCallback('test', positional);
            await scope.assert.rejects(async function () {
                return resolveBodyOrigin(fixture.analysis, { ...callbackOrigin(fixture), location });
            }, { message: /requires a known callback source location/u });
            return scope.assert.collect();
        }
    }),
    test('rejects callback sources outside the frozen project', async function (scope) {
        const fixture = ownedCallback('test', positional);
        await scope.assert.rejects(async function () {
            return resolveBodyOrigin(fixture.analysis, {
                ...callbackOrigin(fixture),
                location: { kind: 'known', file: '/outside/case.ts', line: 1, column: 1 }
            });
        }, { message: /outside the checker project/u });
        return scope.assert.collect();
    }),
    test('rejects anchors outside authoring expressions', async function (scope) {
        const fixture = ownedCallback('test', positional);
        await scope.assert.rejects(async function () {
            return resolveBodyOrigin(fixture.analysis, {
                ...callbackOrigin(fixture),
                location: { kind: 'known', file: '/project/case.ts', line: 1, column: 8 }
            });
        }, { message: /does not identify an authoring call/u });
        return scope.assert.collect();
    }),
    test('rejects foreign authoring declarations', async function (scope) {
        const fixture = ownedCallback('test', positional);
        bindAuthoringCall(fixture, fixture.call, 'test', '/project/application.ts');
        await scope.assert.rejects(async function () {
            return resolveBodyOrigin(fixture.analysis, callbackOrigin(fixture));
        }, { message: /does not identify a supported authoring API/u });
        return scope.assert.collect();
    }),
    test('recognizes namespace-qualified authoring APIs', async function (scope) {
        const fixture = ownedCallback('test', positional);
        const call = sourceCall(
            sourceMember(ast.factory.createIdentifier('authoring'), 'test'),
            fixture.call.arguments
        );
        const qualified = { ...fixture, call };
        attachCallbackSource(qualified, []);
        bindAuthoringCall(qualified, call, 'test', '/project/source/authoring/test.ts');
        scope.assert.equal(await resolveBodyOrigin(qualified.analysis, callbackOrigin(qualified)), qualified.body);
        return scope.assert.collect();
    })
]);
