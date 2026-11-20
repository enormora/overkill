import { z } from 'zod/v4';
import {
    defineBodyReference,
    type TestPlan,
    createRoot,
    createTestCase,
    createTestPlan
} from '../packages/engine/engine.entry-point.ts';

export function bodyReferencePlan(referenced: boolean): TestPlan {
    const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
    const body = referenced
        ? defineBodyReference({
            module: { moduleUrl: 'file:///project/body.mjs', exportName: 'body' },
            realm: 'host',
            version: '1',
            input: null,
            dynamicModules: [],
            parseInput(value) {
                return z.null().parse(value);
            }
        })
        : function unexecutedBody(): never {
            throw new Error('Planning must not execute a body.');
        };
    return createTestPlan(
        createRoot({
            ...metadata,
            title: 'implementation policy',
            children: [ createTestCase({ ...metadata, title: 'case', body }) ]
        })
    );
}
