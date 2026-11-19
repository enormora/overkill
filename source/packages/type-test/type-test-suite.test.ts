import { suite } from '@overkill-dev/test';

import { testNode as assertionPolicy } from './native-assertion-policy.test.ts';
import { testNode as analysisPolicy } from './source-analysis-policy.test.ts';
import { testNode as storagePolicy } from './callback-storage-policy.test.ts';
import { testNode as ownershipPolicy } from './source-ownership-policy.test.ts';
import { testNode as nativeSyntax } from './native-ast-policy.test.ts';
import { testNode as nativeResultPolicy } from './native-result-policy.test.ts';
import { testNode as origins } from './body-origin.test.ts';
import { testNode as assertions } from './assertion-reference.test.ts';

export const testNode = suite('type-test adapter', [
    assertionPolicy,
    analysisPolicy,
    storagePolicy,
    ownershipPolicy,
    nativeSyntax,
    origins,
    assertions,
    nativeResultPolicy
]);
