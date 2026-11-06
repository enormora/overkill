import { basename } from 'node:path';

export function isGeneratedTypeTestPath(path: string): boolean {
    return basename(path).startsWith('.overkill-type-test-');
}
