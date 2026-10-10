import type { Type } from 'cmd-ts';

export const benchmarkProfileType: Type<string[], string | null> = {
    displayName: 'name',
    async from([ profile, ...remainingProfiles ]) {
        if (remainingProfiles.length > 0) {
            throw new TypeError('--profile may only be provided once.');
        }

        return profile ?? null;
    }
};
