import type { IsEqual } from 'type-fest';
import type { Logger } from '@stryker-mutator/api/logging';
import type { FileDescriptions } from '@stryker-mutator/api/core';
import type { TestRunner } from '@stryker-mutator/api/test-runner';
import { suite, test } from '../test/test.entry-point.ts';
import { sameType } from '../type-test/type-test.entry-point.ts';
import type { MicrotestProfileConfig } from '../run/run.entry-point.ts';
import type { createOverkillTestRunner } from './overkill-test-runner.ts';
import type { SelectedMicrotestProfile } from './microtest-profile.ts';
import type { OverkillRunnerOptions } from './runner-settings-schema.ts';

export const testNode = suite('Stryker profile initialization', [
    test('requires injected options and narrows selected profiles to microtests', function (scope) {
        scope.assert(
            sameType<
                IsEqual<
                    Parameters<typeof createOverkillTestRunner>,
                    [Readonly<Record<string, unknown>>, FileDescriptions, Readonly<Pick<Logger, 'info'>>]
                >,
                true
            >()
        );
        scope.assert(sameType<IsEqual<ReturnType<typeof createOverkillTestRunner>, Required<TestRunner>>, true>());
        scope.assert(
            sameType<IsEqual<typeof createOverkillTestRunner.inject, ['options', 'fileDescriptions', 'logger']>, true>()
        );
        scope.assert(sameType<IsEqual<SelectedMicrotestProfile['profile'], MicrotestProfileConfig>, true>());
        scope.assert(sameType<
            IsEqual<OverkillRunnerOptions, {
                readonly configPath: string | null;
                readonly paths: readonly string[];
                readonly profile: string | null;
                readonly freshState: boolean;
                readonly artifactPersistence: 'all' | 'failures' | 'off';
                readonly seed: string;
            }>,
            true
        >());
        return scope.assert.collect();
    })
]);
