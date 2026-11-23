import { suite, test } from '@overkill-dev/test';

import { z } from 'zod/v4';

import { strykerValidationSchema } from '../../../../packages/stryker-runner/runner-options.ts';
import { parseRunnerOptions } from '../../../../packages/stryker-runner/runner-settings-schema.ts';

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
    })
]);
