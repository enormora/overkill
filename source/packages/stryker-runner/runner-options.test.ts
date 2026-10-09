import { z } from 'zod/v4';
import { suite, test } from '../test/test.entry-point.ts';
import { ConfigError } from '../run/config.entry-point.ts';
import { parseRunnerOptions, strykerValidationSchema } from './runner-options.ts';

export const testNode = suite('Stryker adapter settings', [
    test('publishes a schema accepting Stryker options and rejecting invalid adapter settings', function (scope) {
        const schema = z.fromJSONSchema(strykerValidationSchema);

        scope.assert.equal(schema.safeParse({ testRunner: 'overkill' }).success, true);
        scope.assert.equal(schema.safeParse({ overkill: { profile: 'unit', configPath: 'policy.ts' } }).success, true);
        scope.assert.equal(schema.safeParse({ overkill: { profile: [ 'unit', 'browser' ] } }).success, false);
        scope.assert.equal(schema.safeParse({ overkill: { configPath: '' } }).success, false);
        scope.assert.equal(schema.safeParse({ overkill: { browser: true } }).success, false);
        return scope.assert.collect();
    }),
    test('normalizes omitted settings and preserves explicit names and paths', function (scope) {
        for (const value of [ undefined, {}, { profile: null, configPath: null } ]) {
            scope.assert.deepEqual(parseRunnerOptions(value), { configPath: null, profile: null });
        }

        scope.assert.deepEqual(parseRunnerOptions({ profile: 'unit-fast' }), {
            configPath: null,
            profile: 'unit-fast'
        });
        scope.assert.deepEqual(parseRunnerOptions({ configPath: 'policy.ts' }), {
            configPath: 'policy.ts',
            profile: null
        });
        scope.assert.equal(parseRunnerOptions({ profile: ' unit-fast ' }).profile, ' unit-fast ');
        return scope.assert.collect();
    }),
    test('rejects malformed settings and multi-profile selections', function (scope) {
        const invalid = [
            null,
            [],
            'unit',
            { configPath: '' },
            { configPath: ' ' },
            { configPath: 1 },
            { profile: 1 },
            { profile: [ 'unit', 'integration' ] },
            { profiles: [ 'unit' ] },
            { browser: true }
        ];

        for (const value of invalid) {
            scope.assert.throws(function parseInvalidSettings() {
                return parseRunnerOptions(value);
            }, {
                type: ConfigError,
                message: /Invalid overkill Stryker settings/
            });
        }

        return scope.assert.collect();
    })
]);
