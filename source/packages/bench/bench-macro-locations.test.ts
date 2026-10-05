import {
    captureSourceLocation,
    createRoot,
    createTestPlan,
    execute,
    resolveSourceLocation,
    type RunResult,
    type SourceLocation,
    type TestBody,
    type TestPlan,
    type TestScope
} from '../engine/engine.entry-point.ts';
import * as ordinary from '../test/test.entry-point.ts';
import * as bench from './bench.entry-point.ts';

function failingBody(scope: TestScope): ReturnType<TestBody> {
    scope.assert.equal('actual', 'expected');
    return scope.assert.collect();
}

type LocatedMacroPlan = {
    readonly applicationLocation: SourceLocation;
    readonly plan: TestPlan;
};

function createNestedMacroPlan(): LocatedMacroPlan {
    const inner = ordinary.defineMacro(function failingBenchCase() {
        return bench.test('fails', failingBody);
    });
    const outer = bench.defineMacro(function nestedOrdinarySuite() {
        return ordinary.suite('nested', [ inner() ]);
    });
    const callSite = captureSourceLocation();
    const subtree = outer();

    return {
        applicationLocation: resolveSourceLocation(callSite),
        plan: createTestPlan(createRoot({
            annotations: {},
            children: [ subtree ],
            controls: {},
            title: 'root'
        }))
    };
}

function assertMacroApplication(scope: TestScope, actual: SourceLocation, expected: SourceLocation): void {
    scope.assert.equal(actual.file, expected.file);
    scope.assert.equal(actual.line, (expected.line ?? 0) + 1);
}

function assertFailureLocation(scope: TestScope, result: RunResult, expected: SourceLocation): void {
    const outcome = result.perTest[0]?.outcome;

    if (outcome?.kind !== 'fail' || outcome.failures[0].kind !== 'assertion') {
        throw new TypeError('Expected an assertion failure.');
    }

    const location = outcome.failures[0].checks[0].sourceLocations[0];
    scope.assert.equal(location.file, expected.file);
    scope.assert.equal(location.line, expected.line);
}

type LocatedMacroCase = {
    readonly applicationLocation: SourceLocation;
    readonly child: bench.TestCase;
};

function subsequentMacroCase(): LocatedMacroCase {
    const subsequent = ordinary.defineMacro(function laterBenchCase() {
        return bench.test('later macro', failingBody);
    });
    const callSite = captureSourceLocation();
    const child = subsequent();

    return { applicationLocation: resolveSourceLocation(callSite), child };
}

export const testNode = ordinary.suite('source/packages/bench/bench-macro-locations.test.ts', [
    ordinary.test('preserves nested cross-facade macro definition and assertion locations', async function (scope) {
        const { applicationLocation, plan } = createNestedMacroPlan();
        const result = await execute(plan);
        const actual = resolveSourceLocation(plan.discoveredCases[0].definitionLocations[0]);

        assertMacroApplication(scope, actual, applicationLocation);
        scope.assert.equal(plan.discoveredCases[0].definitionLocations.length, 3);
        assertFailureLocation(scope, result, actual);
        return scope.assert.collect();
    }),
    ordinary.test('restores macro locations after a factory throws', function (scope) {
        const broken = bench.defineMacro(function failingFactory() {
            throw new Error('factory failed');
        });

        scope.assert.throws(function () {
            return broken();
        }, { message: 'factory failed' });

        const plain = ordinary.test('outside macro', failingBody);
        const { applicationLocation, child } = subsequentMacroCase();

        scope.assert.equal(plain.definitionLocations.length, 1);
        scope.assert.equal(child.definitionLocations.length, 2);
        assertMacroApplication(scope, resolveSourceLocation(child.definitionLocations[0]), applicationLocation);
        return scope.assert.collect();
    })
]);
