import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as profiles } from '../config/property-profile.test.ts';
import { testNode as collection } from '../run/property-collection.test.ts';
import { testNode as runnerPolicy } from '../integration-tests/run/runner-property-policy.test.ts';
import { testNode as composition } from './property-composition.test.ts';
import { testNode as deterministic } from './property-determinism.test.ts';
import { testNode as execution } from './property-results.test.ts';
import { testNode as scopes } from './property-scope.test.ts';
import { testNode as generators } from './generator-suite.test.ts';

import { testNode as tools } from './property-authoring-tools.test.ts';

export const testNode = suite('property', [
    tools,
    composition,
    profiles,
    collection,
    runnerPolicy,
    generators,
    execution,
    scopes,
    deterministic
]);
