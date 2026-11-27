import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import { isEqualTo, type IsAssignable } from '../../test-support/type-relations.ts';
import {
    CaseRunnerError,
    type isCaseRunnerError,
    type hasAttachedResourceDescriptors,
    type CaseId,
    type CaseRunnerErrorOptions,
    type Diff,
    type DiffPathSegment,
    type FailedCheck,
    type FailedCompositeCheck,
    type FailedForeignCheck,
    type FailedLeafCheck,
    type NonEmptyReadonlyArray,
    type PerTestResult,
    type ReporterEvent,
    type ResolvableSourceLocation,
    type RunnerError,
    type SerializationTruncation,
    type SerializedValue,
    type TestAnnotations,
    type WorkId,
    type TestAnnotationsInput,
    type TestControls,
    type TestControlsInput,
    type TestFailure,
    type TestFamilyId,
    type TestBodyResourceAttachments,
    type TestOutcome
} from './engine.entry-point.ts';

type FailedCheckFixture = {
    readonly actual: { readonly kind: 'number'; readonly value: 1; };
    readonly diff: null;
    readonly expected: { readonly kind: 'undefined'; };
    readonly id: '1';
    readonly kind: 'leaf';
    readonly path: readonly [];
    readonly source: 'assert';
    readonly sourceLocations: readonly [
        { readonly column: null; readonly file: ''; readonly kind: 'known'; readonly line: null; }
    ];
    readonly summary: 'numbers differ';
};

type FailedCheckKeyByName = {
    readonly actual: true;
    readonly diff: true;
    readonly expected: true;
    readonly id: true;
    readonly kind: true;
    readonly path: true;
    readonly source: true;
    readonly sourceLocations: true;
    readonly summary: true;
};

type FailedLeafCheckKey = keyof FailedCheckKeyByName;

type FailedCompositeCheckKeyByName = FailedCheckKeyByName & {
    readonly children: true;
};

type FailedCompositeCheckKey = keyof FailedCompositeCheckKeyByName;

type FailedForeignCheckKeyByName = FailedCheckKeyByName & {
    readonly error: true;
    readonly label: true;
};

type FailedForeignCheckKey = keyof FailedForeignCheckKeyByName;

declare const caseId: CaseId;
declare const workId: WorkId;
declare const unknownValue: unknown;

type CaseIdFixture = {
    readonly file: null;
    readonly params: null;
    readonly suite: readonly ['suite'];
    readonly title: 'case';
};
type TestStartReporterEvent = Extract<ReporterEvent, { readonly kind: 'test-start'; }>;
type SuiteStartReporterEvent = Extract<ReporterEvent, { readonly kind: 'suite-start'; }>;

export const testNode = suite('engine outcomes and data', [
    suite('TestOutcome', [
        test('exports resource descriptor attachment predicates', function (typeScope) {
            typeScope.assert(
                sameType<
                    IsEqual<
                        typeof hasAttachedResourceDescriptors,
                        (attachments: TestBodyResourceAttachments) => boolean
                    >,
                    true
                >()
            );
            return typeScope.assert.collect();
        }),
        test('exports case runner error markers', function (typeScope) {
            const error = new CaseRunnerError('Fixture failed.', {
                cause: unknownValue,
                subtype: 'fixture'
            });

            typeScope.assert(sameType<
                IsEqual<CaseRunnerErrorOptions, {
                    readonly cause: unknown;
                    readonly subtype: RunnerError['subtype'];
                }>,
                true
            >());
            typeScope.assert(sameType.withActual<true>(), isEqualTo<CaseRunnerError>()(error));
            typeScope.assert(sameType.withActual<true>(), isEqualTo<RunnerError>()(error.runnerError(caseId, workId)));
            typeScope.assert(
                sameType<IsEqual<typeof isCaseRunnerError, (value: unknown) => value is CaseRunnerError>, true>()
            );
            return typeScope.assert.collect();
        }),
        test('accepts public outcome shapes', function (typeScope) {
            typeScope.assert(sameType<IsAssignable<{ readonly kind: 'pass'; }, TestOutcome>, true>());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly failures: readonly [
                        {
                            readonly checks: readonly [FailedCheckFixture];
                            readonly kind: 'assertion';
                        }
                    ];
                    readonly kind: 'fail';
                }, TestOutcome>,
                true
            >());
            typeScope.assert(
                sameType<IsAssignable<{ readonly kind: 'skip'; readonly reason: 'filtered'; }, TestOutcome>, true>()
            );
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly kind: 'inconclusive';
                    readonly reason: 'adapter lost result';
                }, TestOutcome>,
                true
            >());
            return typeScope.assert.collect();
        }),
        test('rejects mixed public outcome shapes', function (typeScope) {
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly checks: readonly [];
                    readonly kind: 'pass';
                }, TestOutcome>,
                false
            >());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly kind: 'pass';
                    readonly reason: null;
                }, TestOutcome>,
                false
            >());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly checks: readonly [FailedCheckFixture];
                    readonly kind: 'skip';
                    readonly reason: 'filtered';
                }, TestOutcome>,
                false
            >());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly checks: readonly [FailedCheckFixture];
                    readonly kind: 'inconclusive';
                    readonly reason: 'adapter lost result';
                }, TestOutcome>,
                false
            >());
            typeScope.assert(sameType<IsAssignable<{ readonly kind: 'fail'; }, TestOutcome>, false>());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly checks: readonly [FailedCheckFixture];
                    readonly kind: 'fail';
                    readonly reason: null;
                }, TestOutcome>,
                false
            >());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly failures: readonly [];
                    readonly kind: 'fail';
                }, TestOutcome>,
                false
            >());
            typeScope.assert(sameType<IsAssignable<{ readonly kind: 'skip'; }, TestOutcome>, false>());
            typeScope.assert(sameType<IsAssignable<{ readonly kind: 'inconclusive'; }, TestOutcome>, false>());
            return typeScope.assert.collect();
        }),
        test('exposes structured failed check diagnostics', function (typeScope) {
            typeScope.assert(sameType<keyof FailedCheck, keyof FailedCheckKeyByName>());
            typeScope.assert(sameType<IsEqual<keyof FailedLeafCheck, FailedLeafCheckKey>, true>());
            typeScope.assert(sameType<IsEqual<keyof FailedCompositeCheck, FailedCompositeCheckKey>, true>());
            typeScope.assert(sameType<IsEqual<keyof FailedForeignCheck, FailedForeignCheckKey>, true>());
            typeScope.assert(sameType<IsEqual<FailedCheck['actual'], SerializedValue>, true>());
            typeScope.assert(sameType<IsEqual<FailedCheck['expected'], SerializedValue>, true>());
            typeScope.assert(sameType<IsEqual<FailedCheck['diff'], Diff | null>, true>());
            typeScope.assert(sameType<IsEqual<FailedCheck['path'], readonly DiffPathSegment[]>, true>());
            return typeScope.assert.collect();
        }),
        test('exports serialized value and diff contracts', function (typeScope) {
            typeScope.assert(
                sameType<IsAssignable<{ readonly kind: 'number'; readonly value: '-0'; }, SerializedValue>, true>()
            );
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly kind: 'string';
                    readonly truncation: SerializationTruncation | null;
                    readonly value: 'value';
                }, SerializedValue>,
                true
            >());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly key: { readonly kind: 'string'; readonly value: 'name'; };
                    readonly kind: 'property';
                }, DiffPathSegment>,
                true
            >());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly key: { readonly kind: 'number'; readonly value: 1; };
                    readonly kind: 'map-value';
                }, DiffPathSegment>,
                true
            >());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly actual: 'actual';
                    readonly expected: 'expected';
                    readonly hunks: readonly [];
                    readonly kind: 'string';
                }, Diff>,
                true
            >());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly kind: 'binary';
                    readonly actualHash: 'hash';
                    readonly actualSize: 1;
                    readonly expectedHash: 'hash';
                    readonly expectedSize: 1;
                    readonly ranges: readonly [];
                }, Diff>,
                true
            >());
            return typeScope.assert.collect();
        }),
        test('accepts public test failure shapes', function (typeScope) {
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly checks: readonly [FailedCheckFixture];
                    readonly kind: 'assertion';
                }, TestFailure>,
                true
            >());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly error: {
                        readonly message: 'boom';
                        readonly name: 'Error';
                        readonly stack: null;
                        readonly thrown: unknown;
                    };
                    readonly kind: 'body-error';
                }, TestFailure>,
                true
            >());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly actual: 1;
                    readonly code: 'plan-mismatch';
                    readonly expected: '2';
                    readonly kind: 'test-contract';
                    readonly summary: 'Assertion plan count did not match.';
                }, TestFailure>,
                true
            >());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly error: {
                        readonly message: 'cleanup failed';
                        readonly name: 'Error';
                        readonly stack: null;
                        readonly thrown: unknown;
                    };
                    readonly kind: 'cleanup-error';
                }, TestFailure>,
                true
            >());
            return typeScope.assert.collect();
        })
    ]),
    suite('Test Data', [
        test('exposes authored and resolved test data shapes', function (typeScope) {
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly ownership: readonly ['@team'];
                    readonly tags: readonly ['fast'];
                }, TestAnnotationsInput>,
                true
            >());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly capture: 'buffered';
                    readonly duplicateExecution: 'idempotent';
                    readonly timeoutMilliseconds: number;
                }, TestControlsInput>,
                true
            >());
            typeScope.assert(sameType<
                IsEqual<TestAnnotations, {
                    readonly ownership: readonly string[];
                    readonly tags: readonly string[];
                }>,
                true
            >());
            typeScope.assert(sameType<
                IsEqual<TestControls, {
                    readonly capture: 'buffered' | 'live' | null;
                    readonly duplicateExecution: 'forbidden' | 'idempotent' | null;
                    readonly timeoutMilliseconds: number | null;
                }>,
                true
            >());
            typeScope.assert(sameType<TestFamilyId, string>());
            return typeScope.assert.collect();
        })
    ]),
    suite('CaseId', [
        test('accepts structured public identity shapes', function (typeScope) {
            typeScope.assert(sameType<IsAssignable<CaseIdFixture, CaseId>, true>());
            typeScope.assert(sameType<IsEqual<PerTestResult['id'], CaseId>, true>());
            typeScope.assert(sameType<IsEqual<TestStartReporterEvent['case'], CaseId>, true>());
            typeScope.assert(sameType<
                IsEqual<
                    SuiteStartReporterEvent['suitePath'],
                    readonly {
                        readonly definitionLocations: NonEmptyReadonlyArray<ResolvableSourceLocation>;
                        readonly title: string;
                    }[]
                >,
                true
            >());
            typeScope.assert(sameType<IsEqual<RunnerError['attributedTo'], CaseId | null>, true>());
            return typeScope.assert.collect();
        }),
        test('requires explicit nullable identity fields', function (typeScope) {
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly suite: readonly ['suite'];
                    readonly title: 'case';
                }, CaseId>,
                false
            >());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly file: null;
                    readonly suite: readonly ['suite'];
                    readonly title: 'case';
                }, CaseId>,
                false
            >());
            return typeScope.assert.collect();
        })
    ])
]);
