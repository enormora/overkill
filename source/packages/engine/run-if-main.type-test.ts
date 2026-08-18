import { describe, expect, test } from 'tstyche';
import type {
    Engine,
    OutputRenderer,
    Reporter,
    RunFacts,
    runIfMain,
    RunIfMain,
    RunIfMainOptions,
    RunIfMainRootOptions,
    TestNode
} from './engine.entry-point.ts';

describe('runIfMain', function () {
    test('exposes direct node execution options', function () {
        expect<keyof RunIfMainOptions>().type.toBe<'outputRenderer' | 'reporters' | 'root' | 'runFacts'>();
        expect<RunIfMainOptions>().type.toBe<{
            readonly outputRenderer?: OutputRenderer;
            readonly reporters?: readonly Reporter[];
            readonly root?: RunIfMainRootOptions;
            readonly runFacts?: RunFacts;
        }>();
        expect<keyof RunIfMainRootOptions>().type.toBe<'metadata' | 'name'>();
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
