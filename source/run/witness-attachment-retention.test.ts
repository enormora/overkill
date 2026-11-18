import type { PerTestResult } from '../engine/run-result.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { witnessAttachmentRetention, confirmedWitnessResult } from '../test-support/witness-attachment-retention.ts';
import { propertyCorpusEntry } from '../test-support/property-corpus.ts';
import { testNode as storageOwnership } from './property-witness-run-policy.test.ts';
import { retainPropertyWitnessAttachments } from './property-witness-storage.ts';

export const testNode = suite('confirmed witness attachment retention', [
    storageOwnership,
    test('retains confirmed witness bytes under their original attempt ownership', async function (scope: TestScope) {
        const fixture = witnessAttachmentRetention(scope, null);
        scope.assert.deepEqual(await retainPropertyWitnessAttachments(fixture.execution, fixture.result), []);
        const writes = fixture.operations.filter(function (operation) {
            return operation.kind === 'write';
        });
        const content = Buffer
            .concat(writes.map(function (operation) {
                return Buffer.from(operation.data, 'base64');
            }))
            .toString();
        scope.assert.deepEqual<unknown, unknown>(JSON.parse(content), propertyCorpusEntry);
        scope.assert.deepEqual(
            fixture
                .operations
                .filter(function (operation) {
                    return operation.kind === 'prepare';
                })
                .map(function (operation) {
                    return {
                        owner: operation.owner,
                        source: operation.source,
                        subtype: operation.subtype
                    };
                }),
            [ {
                owner: { kind: 'case', work: fixture.result.perTest[0]?.workId, attempt: { index: 0 } },
                source: 'native',
                subtype: 'witness'
            } ]
        );
        return scope.assert.collect();
    }),
    test('does not retain unconfirmed evidence', async function (scope: TestScope) {
        const fixture = witnessAttachmentRetention(scope, null);
        scope.assert.deepEqual(
            await retainPropertyWitnessAttachments(fixture.execution, confirmedWitnessResult(false)),
            []
        );
        scope.assert.deepEqual(fixture.operations, []);
        return scope.assert.collect();
    }),
    test('does not retain evidence for cases without property attempts', async function (scope: TestScope) {
        const fixture = witnessAttachmentRetention(scope, null);
        const result = {
            ...fixture.result,
            perTest: fixture.result.perTest.map(function removeWitnessEvidence(testCase): PerTestResult {
                const [ first, ...remaining ] = testCase.attempts;
                return {
                    ...testCase,
                    property: null,
                    attempts: [
                        { ...first, property: null },
                        ...remaining.map(function removeAttemptEvidence(attempt) {
                            return { ...attempt, property: null };
                        })
                    ]
                };
            })
        };
        scope.assert.deepEqual(await retainPropertyWitnessAttachments(fixture.execution, result), []);
        scope.assert.deepEqual(fixture.operations, []);
        return scope.assert.collect();
    }),
    test(
        'reports attachment persistence failures without losing confirmed evidence',
        async function (scope: TestScope) {
            const fixture = witnessAttachmentRetention(scope, new Error('Witness backend unavailable.'));
            const errors = await retainPropertyWitnessAttachments(fixture.execution, fixture.result);
            scope.assert.equal(errors.length, 1);
            scope.assert.equal(errors[0]?.message, 'Failed to retain property witnesses.');
            scope.assert.equal(errors[0]?.subtype, 'artifact');
            scope.assert.equal(
                fixture.result.perTest[0]?.property?.invocations[0]?.confirmedWitness,
                propertyCorpusEntry
            );
            return scope.assert.collect();
        }
    )
]);
