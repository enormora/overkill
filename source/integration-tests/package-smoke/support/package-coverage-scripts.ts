export const coverageConfigScript = `
import { defineConfig } from '@overkill-dev/test/config';

export const config = defineConfig({
    profiles: {
        microtest: {
            testFamily: 'microtest',
            timeouts: { collectionMilliseconds: 30000, softMilliseconds: 5000, hardMilliseconds: 10000 },
            coverage: {
                outputDir: 'coverage-smoke',
                sources: { mode: 'all', include: ['coverage-source.ts', 'coverage-types.ts'] }
            },
            execution: { processModel: 'supervised-process', scheduling: 'serial' }
        }
    }
});
`;

export const coverageTypeScriptSource = `const calculator = {
    replace<Target extends number>(value: Target): number {
        return value > 0 ? value * 2 : 0;
    }
};
export const double = calculator.replace;
`;

export const coverageSmokeScript = `
import { test } from '@overkill-dev/test';
import { double } from './coverage-source.ts';

export const testNode = test('covers consumer source', (scope) => {
    scope.assert.equal(double(21), 42);
    scope.assert.equal(double(21), 42);
    scope.assert.equal(double(0), 0);
    return scope.assert.collect();
});
`;
