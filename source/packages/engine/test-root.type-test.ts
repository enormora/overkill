import { describe, expect, test } from 'tstyche';
import {
    createTestPlanFromTestFiles,
    type Engine,
    type Metadata,
    type ResolvedMetadata,
    type TestNode,
    type TestPlan,
    type TestPlanFromTestFilesOptions,
    type TestRoot
} from './engine.entry-point.ts';

declare const testNode: TestNode;

describe('TestRoot', function () {
    test('is separate from TestNode planning paths', function () {
        expect<TestRoot['kind']>().type.toBe<'root'>();
        expect<TestRoot>().type.not.toBeAssignableTo<TestNode>();
        expect<TestPlan['root']>().type.toBe<{
            readonly metadata: ResolvedMetadata;
            readonly title: string;
        }>();
    });

    test('exposes file-backed planning for explicit run inputs', function () {
        expect<TestPlanFromTestFilesOptions>().type.toBe<{
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
                readonly metadata: Metadata;
                readonly title: string;
            };
        }>();
        expect<Engine['createTestPlanFromTestFiles']>().type.toBe<
            (options: TestPlanFromTestFilesOptions) => TestPlan
        >();
        expect<Engine['ownsTestNode']>().type.toBe<(value: unknown) => value is TestNode>();
    });

    test('rejects metadata on file-backed planning entries', function () {
        expect(createTestPlanFromTestFiles).type.not.toBeCallableWith({
            files: [ { file: 'source/users.test.ts', metadata: {}, testNode } ],
            root: {
                metadata: {},
                title: 'root'
            }
        });
    });
});
