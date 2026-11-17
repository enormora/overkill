import { implementationFingerprint } from '../implementation-fingerprint.ts';
import type { ImplementationCatalog } from '../implementation-catalog.ts';
import type { GraphIdentityContents } from '../implementation-build.ts';

export function memoryImplementationCatalog(): ImplementationCatalog {
    const url = 'file:///project/body.mjs';
    const fingerprint = implementationFingerprint('export const body = 42;');
    const identity: GraphIdentityContents = {
        runtime: { node: 'v26.9.0', platform: 'linux', architecture: 'x64', typescript: 'strip' },
        builtins: [ 'node:path' ],
        entries: { [url]: url },
        modules: [ {
            url,
            format: 'module',
            dependencies: {},
            packages: [],
            sourceMap: null,
            deliveredFingerprint: fingerprint,
            sourceFingerprint: fingerprint
        } ]
    };
    return {
        projectRoot: '/project',
        builds: [ {
            graph: { ...identity, build: implementationFingerprint(identity) },
            assignments: [ {
                key: 'first:body',
                role: 'body',
                scope: null,
                binding: null,
                facts: {
                    module: { moduleUrl: url, exportName: 'body' },
                    realm: 'host',
                    version: '1',
                    input: { message: 'identity' },
                    dynamicModules: []
                }
            } ]
        } ]
    };
}
