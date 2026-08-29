import { describe, expect, test } from 'tstyche';
import type {
    Engine,
    Metadata,
    ResolvedMetadata,
    TestNode,
    TestPlan,
    TestPlanFile,
    TestPlanFromTestFilesOptions,
    TestRoot
} from './engine.entry-point.ts';

describe('TestRoot', function () {
    test('is separate from TestNode planning paths', function () {
        expect<TestRoot['kind']>().type.toBe<'root'>();
        expect<TestRoot>().type.not.toBeAssignableTo<TestNode>();
        expect<TestPlan['root']>().type.toBe<{
            readonly metadata: ResolvedMetadata;
            readonly name: string;
        }>();
    });

    test('exposes file-backed planning for explicit run inputs', function () {
        expect<TestPlanFile>().type.toBe<{
            readonly file: string;
            readonly metadata: Metadata;
            readonly testNode: TestNode;
        }>();
        expect<TestPlanFromTestFilesOptions>().type.toBe<{
            readonly files: readonly [TestPlanFile, ...(readonly TestPlanFile[])];
            readonly root: {
                readonly metadata: Metadata;
                readonly name: string;
            };
        }>();
        expect<Engine['createTestPlanFromTestFiles']>().type.toBe<
            (options: TestPlanFromTestFilesOptions) => TestPlan
        >();
        expect<Engine['ownsTestNode']>().type.toBe<(value: unknown) => value is TestNode>();
    });
});
