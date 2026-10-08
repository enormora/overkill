import jsTokens from 'js-tokens';

const trivia = new Set([
    'WhiteSpace',
    'LineTerminatorSequence',
    'MultiLineComment',
    'SingleLineComment',
    'HashbangComment'
]);

export type CoverageToken = {
    readonly value: string;
    readonly start: number;
    readonly type: string;
};

export function isCoverageToken(token: CoverageToken): boolean {
    return !trivia.has(token.type);
}

export function* coverageLexemes(source: string): Generator<CoverageToken, undefined> {
    let start = 0;

    for (const token of jsTokens(source)) {
        yield { start, type: token.type, value: token.value };
        start += token.value.length;
    }
}

export function* coverageTokens(source: string): Generator<CoverageToken, undefined> {
    for (const token of coverageLexemes(source)) {
        if (isCoverageToken(token)) {
            yield token;
        }
    }
}
