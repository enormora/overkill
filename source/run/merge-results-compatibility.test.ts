import { runIfMain } from '#test-runner';
import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { mergeRecordFixture } from '../test-support/merge-record-fixture.ts';
import { mergeRecordSchema, type MergeRecord } from './merge-results-schema.ts';
import { mergeCompatibilityConflicts } from './merge-results-compatibility.ts';

const record = mergeRecordFixture('first', 1, 1);
const { facts } = record;
const { reproducibility } = facts;

export const testNode = createSuite({
    title: 'merge compatibility',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        createTestCase({
            title: 'decodes historical records without manufacturing merge evidence',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            body(scope) {
                const historical = structuredClone(record);
                Reflect.deleteProperty(historical.facts.reproducibility, 'selectedIdentities');
                const decoded = mergeRecordSchema.parse(historical);
                scope.assert.equal(decoded.facts.reproducibility.selectedIdentities, null);
                scope.assert.equal(
                    mergeCompatibilityConflicts([
                        { path: 'historical', record: decoded }
                    ])[0]
                        ?.reason,
                    'missing-evidence'
                );
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'compares complete identity sets and validates their evidence',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            body(scope) {
                const first = createDefaultWorkId(createCaseId('file.ts', [], 'first', null));
                const second = createDefaultWorkId(createCaseId('file.ts', [], 'second', null));
                function selected(identities: readonly typeof first[]): MergeRecord {
                    return mergeRecordSchema.parse({
                        ...record,
                        identities: [ first ],
                        facts: {
                            ...facts,
                            reproducibility: {
                                ...reproducibility,
                                selectedIdentities: identities
                            }
                        }
                    });
                }
                const reference = { path: 'first', record: selected([ first, second ]) };
                scope.assert.deepEqual(
                    mergeCompatibilityConflicts([
                        reference,
                        {
                            path: 'second',
                            record: mergeRecordSchema.parse({ ...selected([ second, first ]), identities: [ second ] })
                        }
                    ]),
                    []
                );
                for (
                    const identities of [
                        [ first ],
                        [ first, second, second ],
                        [ first, { ...second, workload: { name: 'other', params: {} } } ],
                        [ first, { ...second, familyVariant: { family: 'type-test', key: 'compiler' } } ],
                        [ first, {
                            ...second,
                            runtimes: [ { name: 'browser', dimensions: {}, scenarios: {}, variantId: 'other' } ]
                        } ]
                    ]
                ) {
                    scope.assert.equal(
                        mergeCompatibilityConflicts([
                            reference,
                            { path: 'second', record: selected(identities) }
                        ])
                            .length,
                        1
                    );
                }
                scope.assert.equal(
                    mergeCompatibilityConflicts([
                        { path: 'invalid', record: selected([ second ]) }
                    ])[0]
                        ?.reason,
                    'invalid-evidence'
                );
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'rejects each incompatible dimension and missing historical evidence',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            body(scope) {
                const incompatible: readonly [string, MergeRecord][] = [
                    [ 'profile', {
                        ...record,
                        facts: { ...facts, execution: { ...facts.execution, profile: 'other' } }
                    } ],
                    [ 'seed', {
                        ...record,
                        facts: { ...facts, reproducibility: { ...reproducibility, seed: '999' } }
                    } ],
                    [ 'shard-total', {
                        ...record,
                        facts: { ...facts, reproducibility: { ...reproducibility, shard: { index: 1, total: 3 } } }
                    } ],
                    [ 'selected-identities', {
                        ...record,
                        facts: { ...facts, reproducibility: { ...reproducibility, selectedIdentities: null } }
                    } ],
                    [ 'loader', {
                        ...record,
                        facts: { ...facts, loader: { ...facts.loader, sourceMaps: !facts.loader.sourceMaps } }
                    } ],
                    [ 'versions', { ...record, versions: { ...record.versions, engine: 'changed' } } ],
                    [ 'versions', {
                        ...record,
                        versions: { ...record.versions, packages: { '@overkill-dev/run': '1' } }
                    } ]
                ];
                for (const [ field, changed ] of incompatible) {
                    const conflicts = mergeCompatibilityConflicts([
                        { path: 'first.json', record },
                        { path: 'second.json', record: changed }
                    ]);
                    scope.assert.equal(conflicts.length, 1);
                    scope.assert.equal(conflicts[0]?.field, field);
                    scope.assert.equal(conflicts[0]?.sourcePath, 'second.json');
                }
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'permits different hosts and third-party dependencies',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            body(scope) {
                const changed = {
                    ...record,
                    versions: { ...record.versions, node: 'other', packages: { backend: '2' } },
                    facts: { ...facts, environment: { ...facts.environment, projectRoot: '/other' } }
                };
                scope.assert.deepEqual(
                    mergeCompatibilityConflicts([
                        { path: 'first', record },
                        { path: 'second', record: changed }
                    ]),
                    []
                );
                return scope.assert.collect();
            }
        })
    ]
});
await runIfMain(import.meta, testNode);
