import { describe, expect, test } from 'tstyche';
import type {
    Engine,
    Reporter,
    RunFacts,
    runIfMain,
    RunIfMain,
    RunIfMainOptions,
    TestNode
} from './engine.entry-point.ts';

describe('runIfMain', function () {
    test('exposes direct node execution options', function () {
        expect<keyof RunIfMainOptions>().type.toBe<'reporters' | 'runFacts'>();
        expect<RunIfMainOptions>().type.toBe<{
            readonly reporters?: readonly Reporter[];
            readonly runFacts?: RunFacts;
        }>();
    });

    test('returns a void promise', function () {
        expect<RunIfMain>().type.toBe<
            (
                meta: Readonly<ImportMeta>,
                testNode: TestNode,
                options?: RunIfMainOptions
            ) => Promise<void>
        >();
        expect<Engine['runIfMain']>().type.toBe<RunIfMain>();
        expect<typeof runIfMain>().type.toBe<RunIfMain>();
    });
});
