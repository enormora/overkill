import { runnerResult } from '../run/runner-result.ts';
import { type RunResultOverrides, runResultFactory } from './run-result-factory.ts';

export const runnerResultFactory = {
    build(overrides: RunResultOverrides) {
        return runnerResult(runResultFactory.build(overrides));
    }
};
