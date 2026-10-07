import { describe, expect, test } from 'tstyche';
import type * as ordinary from '../test/test.entry-point.ts';
import * as standard from '../test/bench.entry-point.ts';
import * as bench from './bench.entry-point.ts';

const parameterValue = 3;

type TestCallSignatures = {
    (
        ...input: readonly [definition: {
            readonly annotations?: bench.AuthoringAnnotations;
            readonly body: bench.TestBody;
            readonly controls?: bench.AuthoringControls;
            readonly title: string;
        }]
    ): bench.TestCase;
    (...input: readonly [title: string, body: bench.TestBody]): bench.TestCase;
};
type SkippedTestCallSignatures = {
    (
        ...input: readonly [definition: {
            readonly annotations?: bench.AuthoringAnnotations;
            readonly controls?: bench.AuthoringControls;
            readonly reason: string;
            readonly title: string;
        }]
    ): bench.TestCase;
    (...input: readonly [title: string, reason: string]): bench.TestCase;
};
type SuiteCallSignatures = {
    (
        ...input: readonly [definition: {
            readonly annotations?: bench.AuthoringAnnotations;
            readonly children: readonly bench.TestNode[];
            readonly controls?: bench.AuthoringControls;
            readonly title: string;
        }]
    ): bench.Suite;
    (...input: readonly [title: string, children: readonly bench.TestNode[]]): bench.Suite;
};

describe('@overkill-dev/bench', function () {
    test('preserves object and positional overloads', function () {
        expect<typeof bench.test>().type.toBe<TestCallSignatures>();
        expect<typeof bench.skippedTest>().type.toBe<SkippedTestCallSignatures>();
        expect<typeof bench.suite>().type.toBe<SuiteCallSignatures>();
    });
    test('preserves ordinary authoring signatures and public types', function () {
        expect<typeof bench.test>().type.toBe<typeof ordinary.test>();
        expect<typeof bench.skippedTest>().type.toBe<typeof ordinary.skippedTest>();
        expect<typeof bench.suite>().type.toBe<typeof ordinary.suite>();
        expect<typeof bench.table>().type.toBe<typeof ordinary.table>();
        expect<typeof bench.defineMacro>().type.toBe<typeof ordinary.defineMacro>();
        expect<typeof bench.defineParameterizedTestBody>().type.toBe<typeof ordinary.defineParameterizedTestBody>();
    });
    test('preserves annotation and table types', function () {
        expect<bench.AuthoringAnnotations>().type.toBe<ordinary.AuthoringAnnotations>();
        expect<bench.AuthoringControls>().type.toBe<ordinary.AuthoringControls>();
        expect<bench.ParameterizedTestScope<string>>().type.toBe<ordinary.ParameterizedTestScope<string>>();
        expect<bench.TableDefinition<string>>().type.toBe<ordinary.TableDefinition<string>>();
        expect<bench.TableTestBody<string>>().type.toBe<ordinary.TableTestBody<string>>();
    });
    test('infers parameterized bodies and macro return types', function () {
        const body = bench.defineParameterizedTestBody(function (scope, value: number) {
            expect(scope).type.toBe<bench.TestScope>();
            scope.assert.equal(value, parameterValue);
            return scope.assert.collect();
        });
        const child = bench.test('value', body(parameterValue));
        const macro = bench.defineMacro(function (title: string) {
            return bench.suite(title, [ child ]);
        });

        expect(child).type.toBe<bench.TestCase>();
        expect(macro('suite')).type.toBe<bench.Suite>();
        expect(body).type.not.toBeCallableWith('invalid');
        expect(bench.test({ body: body(parameterValue), title: 'object form' })).type.toBe<bench.TestCase>();
        expect(bench.suite({ children: [ child ], title: 'object form' })).type.toBe<bench.Suite>();
        expect(bench.skippedTest('skip', 'unavailable')).type.toBe<bench.TestCase>();
    });
    test('infers table parameters and preserves core node types', function () {
        const rows = [ { value: parameterValue } ];
        expect<bench.TestNode>().type.toBe<ordinary.TestNode>();
        expect<bench.TestScope>().type.toBe<ordinary.TestScope>();
        expect<bench.TestScopeAssertContext>().type.toBe<ordinary.TestScopeAssertContext>();
        expect(bench.table({
            cases: rows,
            test(scope) {
                expect(scope.parameters).type.toBe<typeof rows[number]>();
                scope.assert.equal(scope.parameters.value, parameterValue);
                return scope.assert.collect();
            },
            title: 'rows'
        }))
            .type
            .toBe<bench.Table>();
        expect<bench.TestBody>().type.toBe<ordinary.TestBody>();
    });
});

describe('@overkill-dev/test/bench', function () {
    test('preserves leaf signatures, annotations, and table types', function () {
        expect(standard).type.toBe<typeof bench>();
        expect<standard.AuthoringAnnotations>().type.toBe<bench.AuthoringAnnotations>();
        expect<standard.AuthoringControls>().type.toBe<bench.AuthoringControls>();
        expect<standard.ParameterizedTestScope<string>>().type.toBe<bench.ParameterizedTestScope<string>>();
        expect<standard.TableDefinition<string>>().type.toBe<bench.TableDefinition<string>>();
        expect<standard.TableTestBody<string>>().type.toBe<bench.TableTestBody<string>>();
    });
    test('preserves engine node and scope types', function () {
        expect<standard.Suite>().type.toBe<bench.Suite>();
        expect<standard.Table>().type.toBe<bench.Table>();
        expect<standard.TestBody>().type.toBe<bench.TestBody>();
        expect<standard.TestCase>().type.toBe<bench.TestCase>();
        expect<standard.TestNode>().type.toBe<bench.TestNode>();
        expect<standard.TestScope>().type.toBe<bench.TestScope>();
        expect<standard.TestScopeAssertContext>().type.toBe<bench.TestScopeAssertContext>();
    });
    test('infers table rows and parameterized bodies through the standard subpath', function () {
        expect(standard.table({
            cases: [ { value: parameterValue } ],
            test(scope) {
                expect(scope.parameters.value).type.toBe<number>();
                scope.assert.greaterThan(scope.parameters.value, 0);
                return scope.assert.collect();
            },
            title: 'rows'
        }))
            .type
            .toBe<standard.Table>();
        const body = standard.defineParameterizedTestBody<number>(function (scope, value) {
            scope.assert.equal(value, parameterValue);
            return scope.assert.collect();
        });

        expect(body).type.not.toBeCallableWith('invalid');
        expect(standard.test('parameterized', body(parameterValue))).type.toBe<standard.TestCase>();
    });
});
