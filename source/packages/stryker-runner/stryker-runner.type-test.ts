import { describe, expect, test } from 'tstyche';
import type { TestRunner } from '@stryker-mutator/api/test-runner';
import type { MicrotestProfileConfig } from '../run/run.entry-point.ts';
import type { createOverkillTestRunner } from './overkill-test-runner.ts';
import type { SelectedMicrotestProfile } from './microtest-profile.ts';
import type { OverkillRunnerOptions } from './runner-options.ts';

describe('Stryker profile initialization', function () {
    test('requires injected options and narrows selected profiles to microtests', function () {
        expect<Parameters<typeof createOverkillTestRunner>>().type.toBe<[Readonly<Record<string, unknown>>]>();
        expect<ReturnType<typeof createOverkillTestRunner>>().type.toBe<Required<TestRunner>>();
        expect<typeof createOverkillTestRunner.inject>().type.toBe<['options']>();
        expect<SelectedMicrotestProfile['profile']>().type.toBe<MicrotestProfileConfig>();
        expect<OverkillRunnerOptions>().type.toBe<{
            readonly configPath: string | null;
            readonly profile: string | null;
        }>();
    });
});
