import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
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

declare const userTest: TestNode;

export const testNode = suite('TestRoot', [
    test('is separate from TestNode planning paths', function (typeScope) {
        typeScope.assert(sameType<TestRoot['kind'], 'root'>());
        typeScope.assert(sameType<[TestRoot] extends [TestNode] ? true : false, false>());
        typeScope.assert(sameType<
            IsEqual<TestPlan['root'], {
                readonly annotations: TestAnnotations;
                readonly controls: TestControls;
                readonly title: string;
            }>,
            true
        >());
        return typeScope.assert.collect();
    }),
    test('exposes file-backed planning for explicit run inputs', function (typeScope) {
        typeScope.assert(sameType<TestPlanFromTestFilesOptions, {
            readonly files: readonly [
                {
                    readonly file: string;
                    readonly testNode: TestNode;
                },
                ...(readonly {
                    readonly file: string;
                    readonly testNode: TestNode;
                }[])
            ];
            readonly root: {
                readonly annotations: TestAnnotationsInput;
                readonly controls: TestControlsInput;
                readonly title: string;
            };
        }>());
        typeScope.assert(sameType<
            IsEqual<
                Engine['createTestPlanFromTestFiles'],
                (
                    options: TestPlanFromTestFilesOptions,
                    ...policies: readonly [] | readonly [TestPlanCollectionPolicy]
                ) => TestPlan
            >,
            true
        >());
        typeScope.assert(sameType<IsEqual<Engine['ownsTestNode'], (value: unknown) => value is TestNode>, true>());
        return typeScope.assert.collect();
    }),
    test('rejects metadata on file-backed planning entries', function (typeScope) {
        typeScope.assert(rejectsCall('argument-type'), () =>
            createTestPlanFromTestFiles({
                files: [ { file: 'source/users.test.ts', metadata: {}, testNode: userTest } ],
                root: {
                    annotations: {},
                    controls: {},
                    title: 'root'
                }
            }));
        return typeScope.assert.collect();
    })
]);
