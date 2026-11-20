import { type TestNode, table, suite } from '@overkill-dev/test';

import { parseWitnessFile, type SimulationWitnessFile } from '../packages/engine/engine.entry-point.ts';
import { propertyCorpusEntry } from '../test-support/property-corpus.ts';

const simulation: SimulationWitnessFile = {
    version: 1,
    kind: 'simulation',
    producedBy: { library: 'simulator', libraryVersion: '1.0.0' },
    case: { file: null, params: null, suite: [], title: 'scenario' },
    seed: '-900719925474099312345',
    simulation: { name: 'backend', payload: { version: 1, events: [] } },
    resource: null,
    scenario: null,
    runtimeSnapshot: null,
    faultConfiguration: null
};

export const testNode: TestNode = suite('witness file compatibility', [
    table({
        title: 'preserves version one witness',
        cases: [
            { description: 'property counterexample', input: propertyCorpusEntry },
            {
                description: 'custom counterexample codec',
                input: {
                    ...propertyCorpusEntry,
                    seed: '900719925474099312345',
                    counterexample: {
                        format: { name: 'future-graph', version: 2 },
                        codec: { name: 'application-codec', version: 3 },
                        payload: [ { self: 0, shared: 1 }, { value: 'retained' } ]
                    }
                }
            },
            {
                description: 'located nested property',
                input: {
                    ...propertyCorpusEntry,
                    target: {
                        kind: 'forall',
                        location: { kind: 'known', file: 'laws.ts', line: 7, column: 3 },
                        occurrence: 2,
                        key: null
                    },
                    failureIdentity: { assertion: 'equal' },
                    shrinkPath: [ 0, 2 ]
                }
            },
            {
                description: 'keyed nested property',
                input: {
                    ...propertyCorpusEntry,
                    target: {
                        kind: 'forall',
                        location: { kind: 'unknown' },
                        occurrence: 0,
                        key: 'round-trip'
                    }
                }
            },
            { description: 'simulation seed', input: simulation },
            { description: 'unseeded simulation', input: { ...simulation, seed: null } },
            {
                description: 'resource simulation scenario',
                input: { ...simulation, seed: '42', resource: { name: 'backend' }, scenario: 'timeout' }
            }
        ],
        caseTitle({ description }) {
            return description;
        },
        test(scope) {
            const witness = scope.parameters.input;

            scope.assert.deepEqual(parseWitnessFile(structuredClone(witness)), witness);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects invalid witness',
        cases: [
            { description: 'null', input: null },
            { description: 'empty record', input: {} },
            { description: 'unsupported version', input: { ...simulation, version: 2 } },
            { description: 'unknown kind', input: { ...simulation, kind: 'unknown' } },
            { description: 'unexpected property', input: { ...simulation, unexpected: true } },
            { description: 'exponential seed', input: { ...simulation, seed: '1e3' } },
            { description: 'numeric seed', input: { ...simulation, seed: 42 } },
            {
                description: 'numeric case file',
                input: { ...simulation, case: { ...simulation.case, file: 42 } }
            },
            {
                description: 'undefined simulation payload',
                input: { ...simulation, simulation: { name: 'backend', payload: undefined } }
            },
            {
                description: 'unexpected simulation property',
                input: { ...simulation, simulation: { name: 'backend', payload: {}, extra: true } }
            },
            { description: 'negative property seed', input: { ...propertyCorpusEntry, seed: '-1' } },
            { description: 'negative shrink path', input: { ...propertyCorpusEntry, shrinkPath: [ -1 ] } },
            {
                description: 'negative occurrence',
                input: { ...propertyCorpusEntry, target: { kind: 'forall', occurrence: -1, key: null } }
            },
            {
                description: 'unsupported codec version',
                input: {
                    ...propertyCorpusEntry,
                    counterexample: { ...propertyCorpusEntry.counterexample, codec: { name: 'standard', version: 0 } }
                }
            },
            {
                description: 'infinite runtime snapshot',
                input: { ...simulation, runtimeSnapshot: Number.POSITIVE_INFINITY }
            }
        ],
        caseTitle({ description }) {
            return description;
        },
        test(scope) {
            const value = scope.parameters.input;

            scope.assert.throws(function parseInvalidWitness() {
                parseWitnessFile(value);
            }, { name: 'ZodError' });
            return scope.assert.collect();
        }
    }),
    table({
        title: 'requires nullable witness fields',
        cases: [ 'resource', 'scenario', 'runtimeSnapshot', 'faultConfiguration' ],
        caseTitle(field) {
            return field;
        },
        test(scope) {
            const field = scope.parameters;

            const value = Object.fromEntries(
                Object.entries(simulation).filter(function retained([ key ]) {
                    return key !== field;
                })
            );
            scope.assert.throws(function parseMissingField() {
                parseWitnessFile(value);
            }, { name: 'ZodError' });
            return scope.assert.collect();
        }
    })
]);
