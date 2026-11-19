import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import * as ast from 'typescript-beta/ast';

import { ownedCallback, callbackOrigin as origin } from '../../test-support/callback-source.ts';
import { testDouble } from '../test/test.entry-point.ts';
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
import { collectOriginalAssertions, caseKey } from './original-assertions.ts';
import { nativeReference } from './native-reference.ts';

function bodyOptions(body: ast.ArrowFunction): ast.ObjectLiteralExpression {
    return ast.factory.createObjectLiteralExpression([ sourceProperty('body', body) ]);
}
export const testNode = authoredSuite('isolated callback source ownership', [
    authoredTest('rejects runtime controls before translating a type-test body', async function (scope: TestScope) {
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
    authoredTest('retains unknown source anchors in translation failures', async function (scope: TestScope) {
        const fixture = ownedCallback('test', function (body) {
            return [ body ];
        });
        const selected = fixture.plan.cases[0];
        const result = await collectOriginalAssertions(fixture.analysis, {
            ...fixture.plan,
            cases: [ { ...selected, bodyOrigin: { ...origin(fixture), location: { kind: 'unknown' } } } ]
        });
        scope.assert.equal(result.issues.length, 1);
        scope.assert.equal(result.issues[0]?.owner, caseKey(selected));
        scope.assert.includes(
            result.issues[0]?.reason ?? '',
            'at unknown source: Type-test checking requires a known callback source location'
        );
        return scope.assert.collect();
    }),
    authoredTest('propagates unexpected compiler failures', async function (scope: TestScope) {
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
    ...[ 'test', 'withResource', 'withResources', 'withRuntime' ].map(function (name) {
        return authoredTest(
            `resolves positional ${name} callback without executing it`,
            async function (scope: TestScope) {
                const fixture = ownedCallback(name, function (body) {
                    return [ ast.factory.createStringLiteral('case', ast.TokenFlags.None), body ];
                });
                scope.assert.equal(await resolveBodyOrigin(fixture.analysis, origin(fixture)), fixture.body);
                return scope.assert.collect();
            }
        );
    }),
    ...[ 'createTestCase', 'unknownAuthoring' ].map(function (name) {
        return authoredTest(`resolves explicit body options for ${name}`, async function (scope: TestScope) {
            const fixture = ownedCallback(name, function (body) {
                return [ bodyOptions(body) ];
            });
            scope.assert.equal(await resolveBodyOrigin(fixture.analysis, origin(fixture)), fixture.body);
            return scope.assert.collect();
        });
    }),
    authoredTest('resolves parameterized callback declarations', async function (scope: TestScope) {
        const fixture = ownedCallback('defineParameterizedTestBody', function (body) {
            return [ body ];
        });
        scope.assert.equal(await resolveBodyOrigin(fixture.analysis, origin(fixture)), fixture.body);
        return scope.assert.collect();
    }),
    authoredTest('resolves explicit table callback options', async function (scope: TestScope) {
        const fixture = ownedCallback('table', function (body) {
            return [ ast.factory.createObjectLiteralExpression([ sourceProperty('test', body) ]) ];
        });
        scope.assert.equal(await resolveBodyOrigin(fixture.analysis, origin(fixture)), fixture.body);
        return scope.assert.collect();
    }),
    authoredTest('rejects absent arguments and absent body properties', async function (scope: TestScope) {
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
    authoredTest('rejects options whose later spreads can replace the callback', async function (scope: TestScope) {
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
    authoredTest('rejects options with non-object source ownership', async function (scope: TestScope) {
        const fixture = ownedCallback('createTestCase', function () {
            return [ ast.factory.createStringLiteral('options', ast.TokenFlags.None) ];
        });
        await scope.assert.rejects(async function () {
            await resolveBodyOrigin(fixture.analysis, origin(fixture));
        }, { message: /Unsupported callback options/u });
        return scope.assert.collect();
    }),
    authoredTest('translates owned callback modules and deduplicates their owners', async function (scope: TestScope) {
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
    authoredTest('requires ownership for executable cases and ignores skipped ones', async function (scope: TestScope) {
        const fixture = sourceFixture();
        const original = observationPlan();
        const plan: TestPlan = { ...original, cases: [ { ...original.cases[0], bodyOrigin: null } ] };
        const result = await collectOriginalAssertions(fixture.analysis, plan);
        scope.assert.deepEqual(result.issues, [ {
            owner: caseKey(plan.cases[0]),
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
    authoredTest('retains source anchors in ownership failures', async function (scope: TestScope) {
        const fixture = ownedCallback('test', function () {
            return [];
        });
        const result = await collectOriginalAssertions(fixture.analysis, fixture.plan);
        scope.assert.equal(result.issues.length, 1);
        scope.assert.equal(result.issues[0]?.owner, caseKey(fixture.plan.cases[0]));
        scope.assert.includes(result.issues[0]?.reason ?? '', 'case.ts:1:1: Callback construction has no arguments');
        return scope.assert.collect();
    }),
    ...([ 'sameType', 'assignableTo', 'assignableFrom' ] as const).map(function (name) {
        return authoredTest(`recognizes adapter-owned ${name} references`, async function (scope: TestScope) {
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
        });
    })
]);
