import { describe, expect, test } from 'tstyche';
import type { TestNode, TestPlan, TestRoot } from './engine.entry-point.ts';

describe('TestRoot', function () {
    test('is separate from TestNode planning paths', function () {
        expect<TestRoot['kind']>().type.toBe<'root'>();
        expect<TestRoot>().type.not.toBeAssignableTo<TestNode>();
        expect<TestPlan['root']>().type.toBe<{
            readonly metadata: Readonly<Record<string, unknown>>;
            readonly name: string;
        }>();
    });
});
