import { suite, table, test } from '../packages/test/test.entry-point.ts';
import { workload, type WorkloadParameters } from '../packages/bench/bench.entry-point.ts';

function nestedRecord(depth: number): WorkloadParameters {
    let value: WorkloadParameters = { leaf: true };
    for (let index = 0; index < depth; index += 1) {
        value = { child: value };
    }
    return value;
}

function invalidRecords(): readonly { readonly name: string; readonly value: unknown; }[] {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const sparse = [ 1 ];
    Reflect.deleteProperty(sparse, '0');
    const extraArray = Object.assign([ 1 ], { extra: true });
    const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
    const customArray = [ 1 ];
    Object.setPrototypeOf(customArray, null);
    return [
        { name: 'scalar', value: 1 },
        { name: 'array root', value: [] },
        { name: 'null root', value: null },
        { name: 'undefined', value: { value: undefined } },
        { name: 'infinity', value: { value: Number.POSITIVE_INFINITY } },
        { name: 'nan', value: { value: Number.NaN } },
        { name: 'negative zero', value: { value: -0 } },
        { name: 'bigint', value: { value: 1n } },
        {
            name: 'function',
            value: {
                value() {
                    return 1;
                }
            }
        },
        { name: 'symbol', value: { value: Symbol('value') } },
        { name: 'symbol key', value: { [Symbol('key')]: 1 } },
        { name: 'date', value: { value: new Date(0) } },
        { name: 'cycle', value: cycle },
        { name: 'sparse array', value: { value: sparse } },
        { name: 'array properties', value: { value: extraArray } },
        { name: 'array prototype', value: { value: customArray } },
        { name: 'hidden property', value: hidden },
        { name: 'canonical keys', value: { value: { é: 1, é: 2 } } },
        { name: 'depth', value: { value: nestedRecord(64) } }
    ];
}

export const testNode = suite('workload descriptors', [
    test('snapshots and freezes JSON inputs without freezing their source', function (scope) {
        const input = { packages: 5, nested: { values: [ 1, 2 ], enabled: true, empty: null } };
        const small = workload(' small ', input);
        input.packages = 9;
        input.nested.values.push(3);
        scope.assert.deepEqual(small.parameters, {
            packages: 5,
            nested: { values: [ 1, 2 ], enabled: true, empty: null }
        });
        scope.assert.false(Reflect.set(small.parameters.nested.values, '0', 9));
        scope.assert.true(Object.isFrozen(small));
        scope.assert.true(Object.isFrozen(small.id.params));
        scope.assert.false(Object.isFrozen(input));
        return scope.assert.collect();
    }),
    test('names empty parameter records explicitly', function (scope) {
        const empty = workload('empty', {});
        scope.assert.equal(empty.name, 'empty');
        scope.assert.equal(empty.id.name, empty.name);
        scope.assert.equal(workload(' small ', {}).name, ' small ');
        scope.assert.deepEqual(empty.id.params, {});
        return scope.assert.collect();
    }),
    test('encodes canonical identities without conflating strings and numbers', function (scope) {
        const first = workload('small', { nested: { z: 2, a: [ true, null ] }, packages: 5 });
        const second = workload('small', { packages: 5, nested: { a: [ true, null ], z: 2 } });
        scope.assert.deepEqual(first.id, second.id);
        scope.assert.equal(first.id.params.packages, '5');
        scope.assert.equal(workload('small', { packages: '5' }).id.params.packages, '"5"');
        scope.assert.equal(first.id.params.nested, '{"a":[true,null],"z":2}');
        scope.assert.equal(workload('boundary', { value: nestedRecord(63) }).name, 'boundary');
        return scope.assert.collect();
    }),
    test('rejects getters without invoking them', function (scope) {
        let calls = 0;
        const input = Object.defineProperty({}, 'value', {
            enumerable: true,
            get() {
                calls += 1;
                return 1;
            }
        });
        scope.assert.throws(function () {
            return workload('getter', input);
        }, { message: /lossless/v });
        scope.assert.equal(calls, 0);
        return scope.assert.collect();
    }),
    table({
        title: 'rejects invalid JSON inputs',
        cases: invalidRecords(),
        caseTitle(input) {
            return input.name;
        },
        test(scope) {
            scope.assert.throws(function () {
                Reflect.apply(workload, undefined, [ 'invalid', scope.parameters.value ]);
            }, {
                message: /workload\(\) requires/v
            });
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects invalid names',
        cases: [ '', ' ', 'line\nfeed', '\u{7F}' ],
        test(scope) {
            scope.assert.throws(function () {
                return workload(scope.parameters, {});
            }, { message: /Workload names/v });
            return scope.assert.collect();
        }
    })
]);
