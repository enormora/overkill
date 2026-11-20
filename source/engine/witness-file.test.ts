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
const witnesses = [
    propertyCorpusEntry,
    {
        ...propertyCorpusEntry,
        seed: '900719925474099312345',
        counterexample: {
            format: { name: 'future-graph', version: 2 },
            codec: { name: 'application-codec', version: 3 },
            payload: [ { self: 0, shared: 1 }, { value: 'retained' } ]
        }
    },
    {
        ...propertyCorpusEntry,
        target: {
            kind: 'forall',
            location: { kind: 'known', file: 'laws.ts', line: 7, column: 3 },
            occurrence: 2,
            key: null
        },
        failureIdentity: { assertion: 'equal' },
        shrinkPath: [ 0, 2 ]
    },
    {
        ...propertyCorpusEntry,
        target: {
            kind: 'forall',
            location: { kind: 'unknown' },
            occurrence: 0,
            key: 'round-trip'
        }
    },
    simulation,
    { ...simulation, seed: null },
    { ...simulation, seed: '42', resource: { name: 'backend' }, scenario: 'timeout' }
];
const invalid = [
    null,
    {},
    { ...simulation, version: 2 },
    { ...simulation, kind: 'unknown' },
    { ...simulation, unexpected: true },
    { ...simulation, seed: '1e3' },
    { ...simulation, seed: 42 },
    { ...simulation, case: { ...simulation.case, file: 42 } },
    { ...simulation, simulation: { name: 'backend', payload: undefined } },
    { ...simulation, simulation: { name: 'backend', payload: {}, extra: true } },
    { ...propertyCorpusEntry, seed: '-1' },
    { ...propertyCorpusEntry, shrinkPath: [ -1 ] },
    { ...propertyCorpusEntry, target: { kind: 'forall', occurrence: -1, key: null } },
    {
        ...propertyCorpusEntry,
        counterexample: { ...propertyCorpusEntry.counterexample, codec: { name: 'standard', version: 0 } }
    },
    { ...simulation, runtimeSnapshot: Number.POSITIVE_INFINITY }
];

export const testNode: TestNode = suite('witness file compatibility', [
    table({
        title: 'preserves version one witness',
        cases: witnesses,
        caseTitle(_parameters, index) {
            return `${index}`;
        },
        test(scope) {
            const witness = scope.parameters;

            scope.assert.deepEqual(parseWitnessFile(structuredClone(witness)), witness);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects invalid witness',
        cases: invalid,
        caseTitle(_parameters, index) {
            return `${index}`;
        },
        test(scope) {
            const value = scope.parameters;

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
            return `${field}`;
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
