import * as ast from 'typescript-beta/ast';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import {
    sourceFixture,
    type SourceFixture,
    sourceSymbol,
    sourceFile,
    sourceTree,
    sourceBody,
    sourceCall,
    sourceMember
} from '../../test-support/native-source-fixture.ts';
import { nativeReference } from './native-reference.ts';
import { scopeAssertions, assertionAnnotation } from './scope-assertions.ts';
import { namedBodyParameter } from './source-ownership.ts';

function ownedMatcher(): SourceFixture {
    const fixture = sourceFixture();
    const declaration = ast.factory.createFunctionDeclaration(
        undefined,
        undefined,
        ast.factory.createIdentifier('sameType'),
        undefined,
        []
    );
    sourceFile([ declaration ], '/project/packages/type-test/type-test.entry-point.ts');
    fixture.bindName('sameType', sourceSymbol('sameType', [ declaration ]));
    return fixture;
}
function referenceCall(member: string, called: boolean): ast.Expression {
    const base = ast.factory.createIdentifier('sameType');
    const expression = member.length === 0 ? base : sourceMember(base, member);
    const node = called
        ? ast.factory.createCallExpression(
            expression,
            undefined,
            [
                ast.factory.createKeywordTypeNode(ast.SyntaxKind.StringKeyword),
                ast.factory.createKeywordTypeNode(ast.SyntaxKind.NumberKeyword)
            ],
            [],
            ast.NodeFlags.None
        )
        : expression;
    sourceTree(ast.factory.createExpressionStatement(node));
    return node;
}
function annotatedCall(messages: readonly ast.Expression[]): ast.CallExpression {
    return sourceTree(
        sourceCall(
            sourceCall(
                sourceMember(
                    sourceMember(
                        ast
                            .factory
                            .createIdentifier('scope'),
                        'assert'
                    ),
                    'annotated'
                ),
                messages
            ),
            []
        )
    );
}
export const testNode = suite('native assertion boundary validation', [
    test('recognizes typed adapter references', async function (scope: TestScope) {
        const fixture = ownedMatcher();
        const result = await nativeReference(fixture.analysis, referenceCall('', true));
        scope.assert.equal(result.form, 'typed');
        scope.assert.equal(result.types.length, 2);
        scope.assert.false(result.negated);
        return scope.assert.collect();
    }),
    test('retains negated typed references', async function (scope: TestScope) {
        const fixture = ownedMatcher();
        const result = await nativeReference(fixture.analysis, referenceCall('not', true));
        scope.assert.true(result.negated);
        scope.assert.equal(result.form, 'typed');
        return scope.assert.collect();
    }),
    ...[ '', 'withActual', 'withExpected' ].map(function (member) {
        return test(
            `rejects uncalled reference factory ${member.length === 0 ? 'typed' : member}`,
            async function (scope: TestScope) {
                const fixture = ownedMatcher();
                await scope.assert.rejects(async function () {
                    return nativeReference(fixture.analysis, referenceCall(member, false));
                }, { message: /Invalid native reference factory arguments/u });
                return scope.assert.collect();
            }
        );
    }),
    test('rejects unknown reference members', async function (scope: TestScope) {
        const fixture = ownedMatcher();
        await scope.assert.rejects(async function () {
            return nativeReference(fixture.analysis, referenceCall('unknown', false));
        }, { message: /Unsupported native assertion reference form/u });
        const nested = sourceMember(referenceCall('withActual', false), 'extra');
        sourceTree(ast.factory.createExpressionStatement(nested));
        await scope.assert.rejects(async function () {
            return nativeReference(fixture.analysis, nested);
        }, { message: /Unsupported native assertion reference form/u });
        return scope.assert.collect();
    }),
    test('rejects runtime operands on reference factories', async function (scope: TestScope) {
        const fixture = ownedMatcher();
        const reference = sourceTree(
            sourceCall(ast.factory.createIdentifier('sameType'), [
                ast.factory.createStringLiteral('value', ast.TokenFlags.None)
            ])
        );
        sourceTree(ast.factory.createExpressionStatement(reference));
        await scope.assert.rejects(async function () {
            return nativeReference(fixture.analysis, reference);
        }, { message: /Invalid native reference factory arguments/u });
        return scope.assert.collect();
    }),
    test('rejects native matcher references outside direct assertion boundaries', async function (scope: TestScope) {
        const fixture = ownedMatcher();
        const body = sourceBody([ ast.factory.createExpressionStatement(ast.factory.createIdentifier('sameType')) ]);
        await scope.assert.rejects(async function () {
            return scopeAssertions(fixture.analysis, body, namedBodyParameter(fixture.analysis, body));
        }, { message: /require a direct scope.assert boundary/u });
        return scope.assert.collect();
    }),
    test('accepts annotated assertion boundaries with a static message', async function (scope: TestScope) {
        const fixture = ownedMatcher();
        const call = annotatedCall([ ast.factory.createStringLiteral('type contract', ast.TokenFlags.None) ]);
        const body = sourceBody([ ast.factory.createExpressionStatement(call) ]);
        const analysis = {
            ...fixture.analysis,
            checker: {
                ...fixture.analysis.checker,
                async staticString() {
                    return 'type contract';
                }
            }
        };
        scope.assert.deepEqual(await scopeAssertions(analysis, body, namedBodyParameter(analysis, body)), [ call ]);
        scope.assert.equal(await assertionAnnotation(analysis, call), 'type contract');
        return scope.assert.collect();
    }),
    ...[ [], [
        ast.factory.createStringLiteral('one', ast.TokenFlags.None),
        ast.factory.createStringLiteral('two', ast.TokenFlags.None)
    ] ]
        .map(
            function (messages, index) {
                return test(`rejects annotation arity ${index}`, async function (scope: TestScope) {
                    const fixture = sourceFixture();
                    await scope.assert.rejects(async function () {
                        return assertionAnnotation(fixture.analysis, annotatedCall(messages));
                    }, { message: /require one message/u });
                    return scope.assert.collect();
                });
            }
        ),
    test('rejects annotations without a statically known string', async function (scope: TestScope) {
        const fixture = sourceFixture();
        await scope.assert.rejects(async function () {
            return assertionAnnotation(fixture.analysis, annotatedCall([ ast.factory.createIdentifier('dynamic') ]));
        }, { message: /statically known string message/u });
        return scope.assert.collect();
    }),
    test('allows nested callbacks that do not capture native scope operations', async function (scope: TestScope) {
        const fixture = sourceFixture();
        const nested = ast.factory.createArrowFunction(
            undefined,
            undefined,
            [],
            undefined,
            ast.factory.createToken(ast.SyntaxKind.EqualsGreaterThanToken),
            ast.factory.createStringLiteral('value', ast.TokenFlags.None)
        );
        const body = sourceBody([ ast.factory.createExpressionStatement(nested) ]);
        scope.assert.deepEqual(
            await scopeAssertions(fixture.analysis, body, namedBodyParameter(fixture.analysis, body)),
            []
        );
        return scope.assert.collect();
    }),
    test('rejects assertion references detached inside nested callbacks', async function (scope: TestScope) {
        const fixture = sourceFixture();
        const nested = ast.factory.createArrowFunction(
            undefined,
            undefined,
            [],
            undefined,
            ast.factory.createToken(ast.SyntaxKind.EqualsGreaterThanToken),
            sourceMember(ast.factory.createIdentifier('scope'), 'assert')
        );
        const body = sourceBody([ ast.factory.createExpressionStatement(nested) ]);
        await scope.assert.rejects(async function () {
            return scopeAssertions(fixture.analysis, body, namedBodyParameter(fixture.analysis, body));
        }, { message: /Detached assertion methods/u });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
