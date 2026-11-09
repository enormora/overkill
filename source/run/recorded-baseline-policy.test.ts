import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import {
    defineBaselineAdapter,
    normalizeConfig,
    type OrdinaryBaselineAdapter,
    type ProfileConfig
} from '../packages/run/run.entry-point.ts';
import { recordedReplayProfile } from './run-record-input.ts';
import { restoreReplayProfile } from './replay-profile.ts';

type MicrotestProfile = Extract<ProfileConfig, { readonly testFamily: 'microtest'; }>;
function adapter(context: Readonly<Record<string, string>>): OrdinaryBaselineAdapter {
    return defineBaselineAdapter<never, never, never>({
        subtype: 'content-snapshot',
        comparisonContext: context,
        adapter: {
            id: 'output',
            observe() {
                return { kind: 'not-applicable' };
            },
            propose() {
                throw new Error('Unexpected proposal.');
            },
            compare() {
                throw new Error('Unexpected comparison.');
            }
        },
        toComparisonValue() {
            throw new Error('Unexpected observation.');
        },
        encode() {
            throw new Error('Unexpected encoding.');
        },
        decode() {
            throw new Error('Unexpected decoding.');
        }
    });
}
function configuredProfile(baselineAdapter: OrdinaryBaselineAdapter): MicrotestProfile {
    const config = normalizeConfig({
        profiles: { unit: { testFamily: 'microtest', baselines: { adapters: [ baselineAdapter ] } } }
    });
    const profile = config.profiles.unit;
    if (profile?.testFamily !== 'microtest') {
        throw new Error('Missing profile fixture.');
    }
    return profile;
}
export const testNode = suite('recorded ordinary baseline policy', [
    test('restores adapter references after JSON transport', function (scope: TestScope) {
        const profile = configuredProfile(adapter({ browser: 'reference', platform: 'test' }));
        const json = JSON.stringify(recordedReplayProfile(profile));
        const serialized: unknown = JSON.parse(json);
        const current = configuredProfile(adapter({ platform: 'test', browser: 'reference' }));
        const restored = restoreReplayProfile(serialized, current);
        scope.assert.equal(restored.baselines.adapters[0], current.baselines.adapters[0]);
        scope.assert.equal(restored.baselines.directory, profile.baselines.directory);
        return scope.assert.collect();
    }),
    test('rejects unavailable adapters and changed comparison contexts', function (scope: TestScope) {
        const profile = configuredProfile(adapter({ browser: 'reference' }));
        const serialized = recordedReplayProfile(profile);
        const unavailable = { ...profile, baselines: { ...profile.baselines, adapters: [] } };
        scope.assert.throws(function () {
            return restoreReplayProfile(serialized, unavailable);
        }, { type: TypeError });
        scope.assert.throws(function () {
            return restoreReplayProfile(serialized, configuredProfile(adapter({ browser: 'other' })));
        }, {
            type: TypeError
        });
        return scope.assert.collect();
    }),
    test('keeps legacy profiles free of newly configured baseline adapters', function (scope: TestScope) {
        const profile = configuredProfile(adapter({}));
        const { baselines: _baselines, reporters: _reporters, ...legacy } = profile;
        const restored = restoreReplayProfile(legacy, profile);
        scope.assert.deepEqual(restored.baselines, {
            adapters: [],
            directory: 'test-baselines',
            snapshots: false,
            stale: 'fail'
        });
        return scope.assert.collect();
    })
]);
