import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-identity.ts';

export function implementationFingerprint(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
