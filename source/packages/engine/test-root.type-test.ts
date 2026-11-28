import type { IsEqual, Simplify } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { rejectsCall, sameType } from '@overkill-dev/type-test';
import {
    createTestPlanFromTestFiles,
    type Engine,
    type TestAnnotations,
    type TestAnnotationsInput,
    type TestControls,
    type TestControlsInput,
    type TestNode,
    type TestPlan,
    type TestPlanCollectionPolicy,
    type TestPlanFromTestFilesOptions,
    type TestRoot
} from './engine.entry-point.ts';

type FilePlanEntry = {
    readonly file: string;
    readonly testNode: TestNode;
};
type ExpectedFilePlanOptions = {
    readonly files: readonly [FilePlanEntry, ...(readonly FilePlanEntry[])];
    readonly root: {
        readonly annotations: TestAnnotationsInput;
        readonly controls: TestControlsInput;
        readonly title: string;
    };
};

declare const userTest: TestNode;

export const testNode = suite('Test roots and runtime scenario bounds', [
    test('is separate from TestNode planning paths', function (scope) {
        scope.assert(sameType<TestRoot['kind'], 'root'>());
        scope.assert(sameType<[TestRoot] extends [TestNode] ? true : false, false>());
        scope.assert(sameType<
            IsEqual<TestPlan['root'], {
                readonly annotations: TestAnnotations;
                readonly controls: TestControls;
                readonly title: string;
            }>,
            true
        >());
        return scope.assert.collect();
    }),
    test('exposes file-backed planning for explicit run inputs', function (scope) {
        scope.assert(sameType<IsEqual<Simplify<TestPlanFromTestFilesOptions>, ExpectedFilePlanOptions>, true>());
        scope.assert(sameType<
            IsEqual<
                Engine['createTestPlanFromTestFiles'],
                (
                    options: TestPlanFromTestFilesOptions,
                    ...policies: readonly [] | readonly [TestPlanCollectionPolicy]
                ) => TestPlan
            >,
            true
        >());
        scope.assert(sameType<IsEqual<Engine['ownsTestNode'], (value: unknown) => value is TestNode>, true>());
        return scope.assert.collect();
    }),
    test('rejects metadata on file-backed planning entries', function (scope) {
        scope.assert(rejectsCall('argument-type'), function () {
            return createTestPlanFromTestFiles({
                files: [ { file: 'source/users.test.ts', metadata: {}, testNode: userTest } ],
                root: {
                    annotations: {},
                    controls: {},
                    title: 'root'
                }
            });
        });
        return scope.assert.collect();
    })
]);
