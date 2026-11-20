import { suite } from '@overkill-dev/test';

import { testNode as propertyCorpusCache } from '../../run/property-corpus-cache.test.ts';
import { testNode as coverageSources } from '../../run/coverage-sources.test.ts';

import { testNode as failureArtifactSuite } from '../../run/failure-artifact-suite.test.ts';
import { testNode as benchmarkSubpaths } from '../../packages/test/benchmark-subpaths.test.ts';
import { testNode as propertyCodecValidation } from '../../property/property-codec-validation.test.ts';
import { testNode as propertyCodecExecution } from '../../property/property-codec-execution.test.ts';
import { testNode as attachmentExecution } from '../../run/attachment-execution.test.ts';
import { testNode as storage } from './runtime-storage.ts';
import { testNode as supervision } from './supervision.ts';

export const testNode = suite('execution and source contracts', [
    storage,
    supervision,
    propertyCorpusCache,
    coverageSources,
    failureArtifactSuite,
    benchmarkSubpaths,
    propertyCodecValidation,
    propertyCodecExecution,
    attachmentExecution
]);
