import { z } from 'zod/v4';
import { suite, test } from '../test/test.entry-point.ts';
import { ConfigError } from '../run/config.entry-point.ts';
import { strykerValidationSchema } from './runner-options.ts';
import { parseRunnerOptions } from './runner-settings-schema.ts';

export const testNode = suite('Stryker adapter settings', [
    test('publishes defaults that preserve one campaign seed across normalized options', function (scope) {
        const schema = z.fromJSONSchema(strykerValidationSchema);
        const first = schema.parse({ testRunner: 'overkill' });
        const second = schema.parse({ overkill: {} });
        const settings = z.object({ overkill: z.unknown().transform(parseRunnerOptions) });
        const firstSettings = settings.parse(first).overkill;
        const secondSettings = settings.parse(second).overkill;
        scope.assert.deepEqual(firstSettings, secondSettings);
        scope.assert.equal(firstSettings.freshState, false);
        scope.assert.match(firstSettings.seed, /^(?:0|[1-9]\d*)$/u);
        return scope.assert.collect();
    }),
    test('preserves explicit bigint precision and enabled freshness', function (scope) {
        scope.assert.deepEqual(parseRunnerOptions({ seed: '900719925474099312345', freshState: true }), {
            configPath: null,
            paths: [],
            profile: null,
            seed: '900719925474099312345',
            freshState: true,
            artifactPersistence: 'off'
        });
        return scope.assert.collect();
    }),
    test('normalizes remaining settings without replacing the coordinator seed', function (scope) {
        for (const value of [ { seed: '42' }, { seed: '42', profile: null, configPath: null } ]) {
            scope.assert.deepEqual(parseRunnerOptions(value), {
                configPath: null,
                paths: [],
                profile: null,
                freshState: false,
                artifactPersistence: 'off',
                seed: '42'
            });
        }
        scope.assert.equal(parseRunnerOptions({ seed: '42', profile: ' unit-fast ' }).profile, ' unit-fast ');
        scope.assert.deepEqual(parseRunnerOptions({ seed: '42', paths: [ 'unit.test.ts' ] }).paths, [ 'unit.test.ts' ]);
        scope.assert.equal(parseRunnerOptions({ seed: '42', configPath: 'policy.ts' }).configPath, 'policy.ts');
        return scope.assert.collect();
    }),
    test('normalizes diagnostic persistence without enabling other settings', function (scope) {
        for (const artifactPersistence of [ 'off', 'failures', 'all' ]) {
            const settings = parseRunnerOptions({ seed: '42', artifactPersistence });
            scope.assert.equal(settings.artifactPersistence, artifactPersistence);
            scope.assert.equal(settings.freshState, false);
        }
        for (const artifactPersistence of [ true, null, 'failure', 'ALL', [] ]) {
            scope.assert.throws(function invalidPersistence() {
                parseRunnerOptions({ seed: '42', artifactPersistence });
            }, { type: ConfigError });
        }
        return scope.assert.collect();
    }),
    test('rejects malformed settings and missing worker seeds', function (scope) {
        const schema = z.fromJSONSchema(strykerValidationSchema);
        const invalid = [
            null,
            [],
            'unit',
            {},
            undefined,
            { seed: null },
            { seed: 42 },
            { seed: '-1' },
            { seed: '1.2' },
            { seed: ' 42' },
            { seed: '01' },
            { seed: '42', freshState: null },
            { seed: '42', freshState: 'true' },
            { seed: '42', configPath: '' },
            { seed: '42', configPath: ' ' },
            { seed: '42', configPath: 1 },
            { seed: '42', paths: '' },
            { seed: '42', paths: [ '' ] },
            { seed: '42', paths: [ 1 ] },
            { seed: '42', profile: 1 },
            { seed: '42', profile: [ 'unit', 'integration' ] },
            { seed: '42', profiles: [ 'unit' ] },
            { seed: '42', browser: true }
        ];
        for (const value of invalid) {
            scope.assert.throws(function parseInvalidSettings() {
                return parseRunnerOptions(value);
            }, { type: ConfigError, message: /Invalid overkill Stryker settings/u });
            if (value !== undefined && value !== null && typeof value === 'object' && Object.hasOwn(value, 'seed')) {
                scope.assert.equal(schema.safeParse({ overkill: value }).success, false);
            }
        }
        return scope.assert.collect();
    })
]);
