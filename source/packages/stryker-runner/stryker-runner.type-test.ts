import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test-type-authoring';
import { sameType } from '@overkill-dev/type-test';
import type { Logger } from '@stryker-mutator/api/logging';
import type { FileDescriptions } from '@stryker-mutator/api/core';
import type { TestRunner } from '@stryker-mutator/api/test-runner';
import type { MicrotestProfileConfig } from '../run/run.entry-point.ts';
import type { createOverkillTestRunner } from './overkill-test-runner.ts';
import type { SelectedMicrotestProfile } from './microtest-profile.ts';
import type { OverkillRunnerOptions } from './runner-settings-schema.ts';

export const testNode = suite('Stryker profile initialization', [
    test('requires injected options and narrows selected profiles to microtests', function (typeScope) {
        typeScope.assert(
            sameType<
                Parameters<typeof createOverkillTestRunner>,
                [Readonly<Record<string, unknown>>, FileDescriptions, Readonly<Pick<Logger, 'info'>>]
            >()
        );
        typeScope.assert(sameType<ReturnType<typeof createOverkillTestRunner>, Required<TestRunner>>());
        typeScope.assert(sameType<typeof createOverkillTestRunner.inject, ['options', 'fileDescriptions', 'logger']>());
        typeScope.assert(sameType<IsEqual<SelectedMicrotestProfile['profile'], MicrotestProfileConfig>, true>());
        typeScope.assert(sameType<OverkillRunnerOptions, {
            readonly configPath: string | null;
            readonly paths: readonly string[];
            readonly profile: string | null;
            readonly freshState: boolean;
            readonly artifactPersistence: 'all' | 'failures' | 'off';
            readonly seed: string;
        }>());
        return typeScope.assert.collect();
    })
]);
