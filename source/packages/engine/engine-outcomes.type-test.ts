import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { assignableFrom, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
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
                sameType<typeof hasAttachedResourceDescriptors, (attachments: TestBodyResourceAttachments) => boolean>()
            );
            return typeScope.assert.collect();
        }),
        test('exports case runner error markers', function (typeScope) {
            const error = new CaseRunnerError('Fixture failed.', {
                cause: unknownValue,
                subtype: 'fixture'
            });

            typeScope.assert(sameType<CaseRunnerErrorOptions, {
                readonly cause: unknown;
                readonly subtype: RunnerError['subtype'];
            }>());
            typeScope.assert(sameType.withActual<CaseRunnerError>(), error);
            typeScope.assert(sameType.withActual<RunnerError>(), error.runnerError(caseId, workId));
            typeScope.assert(sameType<typeof isCaseRunnerError, (value: unknown) => value is CaseRunnerError>());
            return typeScope.assert.collect();
        }),
        test('accepts public outcome shapes', function (typeScope) {
            typeScope.assert(assignableFrom<TestOutcome, { readonly kind: 'pass'; }>());
            typeScope.assert(assignableFrom<TestOutcome, {
                readonly failures: readonly [
                    {
                        readonly checks: readonly [FailedCheckFixture];
                        readonly kind: 'assertion';
                    }
                ];
                readonly kind: 'fail';
            }>());
            typeScope.assert(assignableFrom<TestOutcome, { readonly kind: 'skip'; readonly reason: 'filtered'; }>());
            typeScope.assert(assignableFrom<TestOutcome, {
                readonly kind: 'inconclusive';
                readonly reason: 'adapter lost result';
            }>());
            return typeScope.assert.collect();
        }),
        test('rejects mixed public outcome shapes', function (typeScope) {
            typeScope.assert(assignableFrom.not<TestOutcome, {
                readonly checks: readonly [];
                readonly kind: 'pass';
            }>());
            typeScope.assert(assignableFrom.not<TestOutcome, {
                readonly kind: 'pass';
                readonly reason: null;
            }>());
            typeScope.assert(assignableFrom.not<TestOutcome, {
                readonly checks: readonly [FailedCheckFixture];
                readonly kind: 'skip';
                readonly reason: 'filtered';
            }>());
            typeScope.assert(assignableFrom.not<TestOutcome, {
                readonly checks: readonly [FailedCheckFixture];
                readonly kind: 'inconclusive';
                readonly reason: 'adapter lost result';
            }>());
            typeScope.assert(assignableFrom.not<TestOutcome, { readonly kind: 'fail'; }>());
            typeScope.assert(assignableFrom.not<TestOutcome, {
                readonly checks: readonly [FailedCheckFixture];
                readonly kind: 'fail';
                readonly reason: null;
            }>());
            typeScope.assert(assignableFrom.not<TestOutcome, {
                readonly failures: readonly [];
                readonly kind: 'fail';
            }>());
            typeScope.assert(assignableFrom.not<TestOutcome, { readonly kind: 'skip'; }>());
            typeScope.assert(assignableFrom.not<TestOutcome, { readonly kind: 'inconclusive'; }>());
            return typeScope.assert.collect();
        }),
        test('exposes structured failed check diagnostics', function (typeScope) {
            typeScope.assert(sameType<keyof FailedCheck, keyof FailedCheckKeyByName>());
            typeScope.assert(sameType<keyof FailedLeafCheck, FailedLeafCheckKey>());
            typeScope.assert(sameType<keyof FailedCompositeCheck, FailedCompositeCheckKey>());
            typeScope.assert(sameType<keyof FailedForeignCheck, FailedForeignCheckKey>());
            typeScope.assert(sameType<FailedCheck['actual'], SerializedValue>());
            typeScope.assert(sameType<FailedCheck['expected'], SerializedValue>());
            typeScope.assert(sameType<FailedCheck['diff'], Diff | null>());
            typeScope.assert(sameType<FailedCheck['path'], readonly DiffPathSegment[]>());
            return typeScope.assert.collect();
        }),
        test('exports serialized value and diff contracts', function (typeScope) {
            typeScope.assert(assignableFrom<SerializedValue, { readonly kind: 'number'; readonly value: '-0'; }>());
            typeScope.assert(assignableFrom<SerializedValue, {
                readonly kind: 'string';
                readonly truncation: SerializationTruncation | null;
                readonly value: 'value';
            }>());
            typeScope.assert(assignableFrom<DiffPathSegment, {
                readonly key: { readonly kind: 'string'; readonly value: 'name'; };
                readonly kind: 'property';
            }>());
            typeScope.assert(assignableFrom<DiffPathSegment, {
                readonly key: { readonly kind: 'number'; readonly value: 1; };
                readonly kind: 'map-value';
            }>());
            typeScope.assert(assignableFrom<Diff, {
                readonly actual: 'actual';
                readonly expected: 'expected';
                readonly hunks: readonly [];
                readonly kind: 'string';
            }>());
            typeScope.assert(assignableFrom<Diff, {
                readonly kind: 'binary';
                readonly actualHash: 'hash';
                readonly actualSize: 1;
                readonly expectedHash: 'hash';
                readonly expectedSize: 1;
                readonly ranges: readonly [];
            }>());
            return typeScope.assert.collect();
        }),
        test('accepts public test failure shapes', function (typeScope) {
            typeScope.assert(assignableFrom<TestFailure, {
                readonly checks: readonly [FailedCheckFixture];
                readonly kind: 'assertion';
            }>());
            typeScope.assert(assignableFrom<TestFailure, {
                readonly error: {
                    readonly message: 'boom';
                    readonly name: 'Error';
                    readonly stack: null;
                    readonly thrown: unknown;
                };
                readonly kind: 'body-error';
            }>());
            typeScope.assert(assignableFrom<TestFailure, {
                readonly actual: 1;
                readonly code: 'plan-mismatch';
                readonly expected: '2';
                readonly kind: 'test-contract';
                readonly summary: 'Assertion plan count did not match.';
            }>());
            typeScope.assert(assignableFrom<TestFailure, {
                readonly error: {
                    readonly message: 'cleanup failed';
                    readonly name: 'Error';
                    readonly stack: null;
                    readonly thrown: unknown;
                };
                readonly kind: 'cleanup-error';
            }>());
            return typeScope.assert.collect();
        })
    ]),
    suite('Test Data', [
        test('exposes authored and resolved test data shapes', function (typeScope) {
            typeScope.assert(assignableFrom<TestAnnotationsInput, {
                readonly ownership: readonly ['@team'];
                readonly tags: readonly ['fast'];
            }>());
            typeScope.assert(assignableFrom<TestControlsInput, {
                readonly capture: 'buffered';
                readonly duplicateExecution: 'idempotent';
                readonly timeoutMilliseconds: number;
            }>());
            typeScope.assert(sameType<TestAnnotations, {
                readonly ownership: readonly string[];
                readonly tags: readonly string[];
            }>());
            typeScope.assert(sameType<TestControls, {
                readonly capture: 'buffered' | 'live' | null;
                readonly duplicateExecution: 'forbidden' | 'idempotent' | null;
                readonly timeoutMilliseconds: number | null;
            }>());
            typeScope.assert(sameType<TestFamilyId, string>());
            return typeScope.assert.collect();
        })
    ]),
    suite('CaseId', [
        test('accepts structured public identity shapes', function (typeScope) {
            typeScope.assert(assignableFrom<CaseId, CaseIdFixture>());
            typeScope.assert(sameType<PerTestResult['id'], CaseId>());
            typeScope.assert(sameType<TestStartReporterEvent['case'], CaseId>());
            typeScope.assert(sameType<
                SuiteStartReporterEvent['suitePath'],
                readonly {
                    readonly definitionLocations: NonEmptyReadonlyArray<ResolvableSourceLocation>;
                    readonly title: string;
                }[]
            >());
            typeScope.assert(sameType<RunnerError['attributedTo'], CaseId | null>());
            return typeScope.assert.collect();
        }),
        test('requires explicit nullable identity fields', function (typeScope) {
            typeScope.assert(assignableFrom.not<CaseId, {
                readonly suite: readonly ['suite'];
                readonly title: 'case';
            }>());
            typeScope.assert(assignableFrom.not<CaseId, {
                readonly file: null;
                readonly suite: readonly ['suite'];
                readonly title: 'case';
            }>());
            return typeScope.assert.collect();
        })
    ])
]);
