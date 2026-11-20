import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { generatorContext } from '../test-support/generator-execution.ts';
import { gen } from './generators.ts';
import { readGeneratorCodec, readGeneratorEnumeration, readGeneratorEdges, isGenerator } from './generator.ts';
import { enumerateDomain, doubleDomain } from './generator-enumeration.ts';

export const testNode = authoredSuite('fixed generator domain admission', [
    ...[ readGeneratorCodec, readGeneratorEnumeration ].map(function (read, index) {
        return authoredTest(`rejects unbranded generator domain ${index}`, function (scope: TestScope) {
            scope.assert.throws(function () {
                Reflect.apply(read, undefined, [ {} ]);
            }, { message: 'Property requires an Overkill generator.' });
            return scope.assert.collect();
        });
    }),
    authoredTest('enumerates finite filters without invoking a random generator', function (scope: TestScope) {
        const context = generatorContext(10, 3, 100);
        const domain = gen.boolean().filter(Boolean);
        const inputs = enumerateDomain(domain, context, 2);
        scope.require.notNull(inputs);
        scope.assert.deepEqual(
            inputs.map(function (input) {
                return input();
            }),
            [ true ]
        );
        return scope.assert.collect();
    }),
    authoredTest('rejects nonboolean filter results during finite enumeration', function (scope: TestScope) {
        const domain: unknown = Reflect.apply(gen.boolean().filter, undefined, [ function () {
            return 42;
        } ]);
        if (!isGenerator(domain)) {
            throw new Error('Expected a filtered generator.');
        }
        scope.assert.throws(function () {
            enumerateDomain(domain, generatorContext(10, 3, 100), 2);
        }, { message: 'Generator filter predicates must return a boolean.' });
        return scope.assert.collect();
    }),
    authoredTest('returns no finite catalog when distinct values exceed the limit', function (scope: TestScope) {
        scope.assert.equal(enumerateDomain(gen.boolean(), generatorContext(10, 3, 100), 1), null);
        return scope.assert.collect();
    }),
    authoredTest('preserves enumeration work failures', function (scope: TestScope) {
        scope.assert.throws(function () {
            enumerateDomain(gen.boolean(), generatorContext(10, 3, 0), 2);
        }, { message: 'Generator work exhausted.' });
        return scope.assert.collect();
    }),
    authoredTest('enumerates nonzero floating point bounds exactly', function (scope: TestScope) {
        scope.assert.deepEqual(Array.from(doubleDomain(1, 1)), [ 1 ]);
        return scope.assert.collect();
    }),
    authoredTest('reconstructs dependent fixed edge values', function (scope: TestScope) {
        const generator = gen.constant(1).flatMap(function (value) {
            return gen.constant(value + 1);
        });
        const edges = Array.from(readGeneratorEdges(generator)(generatorContext(10, 3, 100)));
        scope.assert.deepEqual(
            edges.map(function (input) {
                return input();
            }),
            [ 2 ]
        );
        return scope.assert.collect();
    }),
    authoredTest('rejects dependent domains that change before reconstruction', function (scope: TestScope) {
        let calls = 0;
        const generator = gen.constant(1).flatMap(function () {
            calls += 1;
            return gen.constant(2).filter(function () {
                return calls === 1;
            });
        });
        const inputs = Array.from(
            readGeneratorEnumeration(generator)({
                ...generatorContext(10, 3, 100),
                discover() {
                    return undefined;
                }
            })
        );
        const input = inputs[0];
        scope.require.defined(input);
        scope.assert.throws(input, { message: 'Dependent domain changed.' });
        return scope.assert.collect();
    })
]);
