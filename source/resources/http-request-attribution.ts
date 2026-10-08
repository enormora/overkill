import type { TranscriptScope } from '../packages/simulation/transcript.entry-point.ts';

type ExpectedHttpRequest = {
    readonly scope: TranscriptScope | null;
    readonly undiciRequest: Readonly<Record<string, unknown>> | null;
};
export type HttpRequestAttribution = {
    readonly remember: (
        identity: string,
        scope: TranscriptScope | null,
        request: Readonly<Record<string, unknown>> | null
    ) => void;
    readonly take: (identity: string) => ExpectedHttpRequest | null;
};
export function createHttpRequestAttribution(): HttpRequestAttribution {
    const requests = new Map<string, readonly ExpectedHttpRequest[]>();
    return {
        remember(identity, scope, request) {
            requests.set(identity, [ ...requests.get(identity) ?? [], { scope, undiciRequest: request } ]);
        },
        take(identity) {
            const pending = requests.get(identity) ?? [];
            const first = pending[0];
            if (first === undefined) {
                return null;
            }
            const ambiguous = pending.some(function differentScope(request) {
                return request.scope !== first.scope;
            });
            requests.set(
                identity,
                pending.slice(1).map(function retainedScope(request) {
                    return ambiguous ? { scope: null, undiciRequest: null } : request;
                })
            );
            return ambiguous ? { scope: null, undiciRequest: null } : first;
        }
    };
}
