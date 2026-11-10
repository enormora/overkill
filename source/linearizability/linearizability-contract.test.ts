import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { gen, property } from '../packages/property/property.entry-point.ts';
import {
    linearizability,
    type LinearizabilityDefinition
} from '../packages/linearizability/linearizability.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';

type MalformedProgram = { readonly title: string; readonly input: () => unknown; };

function sparseArray(): unknown[] {
    const values: unknown[] = [];
    values.length = 1;
    return values;
}

const malformedPrograms: readonly MalformedProgram[] = [
    {
        title: 'scalar program',
        input() {
            return null;
        }
    },
    {
        title: 'non-array lane',
        input() {
            return [ null ];
        }
    },
    {
        title: 'sparse lanes',
        input: sparseArray
    },
    {
        title: 'sparse operations',
        input() {
            return [ sparseArray() ];
        }
    }
];
const definition: LinearizabilityDefinition<number, number, unknown, null> = {
    create() {
        return null;
    },
    run() {
        return null;
    },
    model: {
        initial() {
            return 0;
        },
        transition(state, observation) {
            return observation.outcome.kind === 'returned' && observation.outcome.value === null
                ? { kind: 'enabled', state }
                : { kind: 'disabled' };
        }
    },
    maxWork: 100
};

export const testNode = suite('linearizability authoring contracts', [
    test('rejects invalid budgets and callbacks before executing user code', function (scope) {
        const created: number[] = [];
        const declaration = {
            ...definition,
            create() {
                created.push(1);
                return null;
            }
        };
        for (const maxWork of [ 0, -1, 0.5, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1 ]) {
            scope.assert.throws(function () {
                linearizability({ ...declaration, maxWork });
            }, { type: TypeError });
        }
        scope.assert.throws(function () {
            Reflect.apply(linearizability, undefined, [ { ...declaration, run: null } ]);
        }, { type: TypeError });
        scope.assert.empty(created);
        return scope.assert.collect();
    }),
    ...malformedPrograms.map(function ({ title, input }) {
        return test(`rejects ${title} before system creation`, async function (scope) {
            const created: number[] = [];
            const body = linearizability({
                ...definition,
                create() {
                    created.push(1);
                    return null;
                }
            });
            const result = await executePropertyNode(
                property({
                    title,
                    generator: gen.constant(null).map(input),
                    async test(value, sample) {
                        const pending: unknown = Reflect.apply(body, undefined, [ value, sample ]);
                        await Promise.resolve(pending);
                        throw new Error('Malformed program was accepted.');
                    }
                }),
                propertyExecutionDefaults
            );
            const outcome = result.perTest[0]?.outcome;
            if (outcome?.kind !== 'fail' || outcome.failures[0].kind !== 'body-error') {
                throw new Error('Expected malformed input to produce a body error.');
            }
            scope.assert.equal(outcome.failures[0].error.name, 'TypeError');
            scope.assert.empty(created);
            return scope.assert.collect();
        });
    }),
    ...[ null, undefined, function returnedFunction() {
        return 1;
    } ]
        .map(function (expected, index) {
            return test(`preserves synchronous output ${index}`, async function (scope) {
                const result = await executePropertyNode(
                    property({
                        title: 'synchronous output',
                        generator: gen.tuple(gen.tuple(gen.constant(0))),
                        test: linearizability({
                            create() {
                                return null;
                            },
                            run(operation: number) {
                                if (operation !== 0) {
                                    throw new Error('Unexpected operation.');
                                }
                                return expected;
                            },
                            model: {
                                initial() {
                                    return 0;
                                },
                                transition(state, observation) {
                                    const matches = observation.outcome.kind === 'returned' &&
                                        observation.outcome.value === expected;
                                    return matches ? { kind: 'enabled', state } : { kind: 'disabled' };
                                }
                            },
                            maxWork: 100
                        })
                    }),
                    propertyExecutionDefaults
                );
                scope.assert.equal(result.summary.passed, 1);
                return scope.assert.collect();
            });
        })
]);

await runIfMain(import.meta, testNode);
