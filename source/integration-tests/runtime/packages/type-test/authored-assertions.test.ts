import { suite, test } from '@overkill-dev/test';
import { runNativeProject } from '../../../../test-support/native-type-project.ts';

export const testNode = suite('authored type assertions', [
    test('selects regular type-table rows and reports the key evidence', async function (scope) {
        const definitions = `type PublicApi = { readonly run?: () => void };
const describe = types.table({
    title: 'public API',
    cases: [
        { title: 'exposes run', assertions: [types.hasKey<PublicApi, 'run'>()] },
        { title: 'hides run', assertions: [types.equal<1, 1>(), types.lacksKey<PublicApi, 'run'>()] }
    ]
});
const nodes = [describe];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.deepEqual(result.errors, []);
        scope.assert.deepEqual(result.completions, [
            { title: 'exposes run', verdict: 'pass' },
            { title: 'hides run', verdict: 'fail' }
        ]);
        scope.assert.includes(result.diagnostics.join(' '), 'lacksKey');
        scope.assert.includes(result.diagnostics.join(' '), 'keys: "run"');
        const selected = await runNativeProject(scope.cleanup, definitions, [ 'exposes run' ]);
        scope.assert.deepEqual(selected.errors, []);
        scope.assert.deepEqual(selected.completions, [ { title: 'exposes run', verdict: 'pass' } ]);
        return scope.assert.collect();
    }),
    test('reports inferred callback types under the owning test', async function (scope) {
        const definitions = `function supply(callback: (value: string) => void): void { callback('Ada'); }
const nodes=[test('nested',scope=>{
    supply(value => {
        scope.assert(same<typeof value,string>());
        scope.assert(same<typeof value,number>());
    });
    return scope.assert.collect();
})];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.deepEqual(result.completions, [ { title: 'nested', verdict: 'fail' } ]);
        scope.assert.deepEqual(result.errors, []);
        scope.assert.includes(result.diagnostics.join('\n'), 'Type relation sameType');
        scope.assert.equal(result.checkerFacts?.compilers[0]?.evidence?.length, 2);
        return scope.assert.collect();
    }),
    test('reports accepted and rejected calls under their owning tests', async function (scope) {
        const definitions = `function greet(name: string): string { return name; }
function overloaded(value: string): string;
function overloaded(value: number): number;
function overloaded(value: string | number): string | number { return value; }
const nodes=[
    test('accepts a name',scope=>{
        bodyCalls++;
        scope.assert(acceptsCall, () => greet('Adá'));
        return scope.assert.collect();
    }),
    test('requires a name',scope=>{
        scope.assert(rejectsCall('argument-count'), () => greet());
        scope.assert(rejectsCall('argument-type'), () => greet(42));
        scope.assert(rejectsCall('no-matching-overload'), () => overloaded(true));
        return scope.assert.collect();
    }),
    test('reports a different reason',scope=>{
        scope.assert(rejectsCall('argument-count'), () => greet(42));
        return scope.assert.collect();
    }),
    test('reports an unexpectedly rejected call',scope=>{
        scope.assert(acceptsCall, () => greet(42));
        return scope.assert.collect();
    }),
    test('reports an unexpectedly valid call',scope=>{
        scope.assert(rejectsCall('argument-count'), () => greet('Ada'));
        return scope.assert.collect();
    })
];`;
        const full = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.deepEqual(full.errors, []);
        scope.assert.deepEqual(full.completions, [
            { title: 'accepts a name', verdict: 'pass' },
            { title: 'requires a name', verdict: 'pass' },
            { title: 'reports a different reason', verdict: 'fail' },
            { title: 'reports an unexpectedly rejected call', verdict: 'fail' },
            { title: 'reports an unexpectedly valid call', verdict: 'fail' }
        ]);
        scope.assert.deepEqual(
            full.diagnostics.map(function observedFailure(message) {
                return [ 'TS2345', 'Call accepted' ].find(function matches(marker) {
                    return message.includes(marker);
                });
            }),
            [ 'TS2345', 'TS2345', 'Call accepted' ]
        );
        scope.assert.equal(full.bodyCalls, 0);

        const selected = await runNativeProject(scope.cleanup, definitions, [ 'accepts a name' ]);
        scope.assert.deepEqual(selected.errors, []);
        scope.assert.deepEqual(selected.completions, [ { title: 'accepts a name', verdict: 'pass' } ]);
        return scope.assert.collect();
    }),
    test('keeps unrelated callback diagnostics as project errors', async function (scope) {
        const definitions = `function greet(name: string): string { return name; }
function supply(callback: () => string): string { return callback(); }
const nodes=[test('unrelated callback error',scope=>{
    scope.assert(rejectsCall('argument-type'), () => supply(() => greet(42)));
    return scope.assert.collect();
})];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.summary.inconclusive, 1);
        scope.assert.includes(result.errors.join('\n'), 'TS2345');
        return scope.assert.collect();
    }),
    test('does not attribute a probe through a shadowed scope', async function (scope) {
        const definitions = `function greet(name: string): string { return name; }
const nodes=[test('shadowed scope',scope=>{
    function nested(scope: engine.TestScope): void {
        scope.assert(rejectsCall('argument-count'), () => greet());
    }
    void nested;
    return scope.assert.collect();
})];`;
        const result = await runNativeProject(scope.cleanup, definitions, null);
        scope.assert.equal(result.summary.inconclusive, 1);
        scope.assert.includes(result.errors.join('\n'), 'TS2554');
        return scope.assert.collect();
    })
]);
