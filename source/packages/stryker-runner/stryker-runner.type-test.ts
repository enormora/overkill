import { describe, expect, test } from 'tstyche';
import type { Logger } from '@stryker-mutator/api/logging';
import type { FileDescriptions } from '@stryker-mutator/api/core';
import type { TestRunner } from '@stryker-mutator/api/test-runner';
import type { MicrotestProfileConfig } from '../run/run.entry-point.ts';
import type { createOverkillTestRunner } from './overkill-test-runner.ts';
import type { SelectedMicrotestProfile } from './microtest-profile.ts';
import type { OverkillRunnerOptions } from './runner-options.ts';

describe('Stryker profile initialization', function () {
    test('requires injected options and narrows selected profiles to microtests', function () {
        expect<Parameters<typeof createOverkillTestRunner>>().type.toBe<
            [Readonly<Record<string, unknown>>, FileDescriptions, Readonly<Pick<Logger, 'info'>>]
        >();
        expect<ReturnType<typeof createOverkillTestRunner>>().type.toBe<Required<TestRunner>>();
        expect<typeof createOverkillTestRunner.inject>().type.toBe<['options', 'fileDescriptions', 'logger']>();
        expect<SelectedMicrotestProfile['profile']>().type.toBe<MicrotestProfileConfig>();
        expect<OverkillRunnerOptions>().type.toBe<{
            readonly configPath: string | null;
            readonly paths: readonly string[];
            readonly profile: string | null;
            readonly freshState: boolean;
            readonly seed: string;
        }>();
    });
});
