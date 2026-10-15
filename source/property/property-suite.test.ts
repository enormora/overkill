import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as profiles } from '../config/property-profile.test.ts';
import { testNode as collection } from '../run/property-collection.test.ts';
import { testNode as runnerPolicy } from '../integration-tests/run/runner-property-policy.test.ts';
import { testNode as authoring } from './property-authoring.test.ts';
import { testNode as composition } from './property-composition.test.ts';

export const testNode = suite('property', [ authoring, composition, profiles, collection, runnerPolicy ]);
