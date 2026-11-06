export type SourceRange = { readonly start: number; readonly end: number; };
export type SourceMapping = {
    readonly generated: SourceRange;
    readonly original: SourceRange;
    readonly kind: 'anchored' | 'copied';
};
export type TranslatedModule = {
    readonly path: string;
    readonly originalText: string;
    readonly text: string;
    readonly mappings: readonly SourceMapping[];
};

function validateRange(range: SourceRange, length: number): void {
    if (
        !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 ||
        range.end < range.start ||
        range.end > length
    ) {
        throw new Error('Invalid source range.');
    }
}
function validateMapping(module: TranslatedModule, mapping: SourceMapping, end: number): void {
    validateRange(mapping.original, module.originalText.length);
    validateRange(mapping.generated, module.text.length);
    if (mapping.generated.start !== end) {
        throw new Error(`Discontinuous mapping: ${module.path}`);
    }
    const copiedText = module.text.slice(mapping.generated.start, mapping.generated.end);
    const originalText = module.originalText.slice(mapping.original.start, mapping.original.end);
    if (mapping.kind === 'copied' && copiedText !== originalText) {
        throw new Error(`Copied source mapping changed text: ${module.path}`);
    }
}
export function validateMappings(module: TranslatedModule): void {
    const end = module.mappings.reduce(function validate(previousEnd, mapping) {
        validateMapping(module, mapping, previousEnd);
        return mapping.generated.end;
    }, 0);
    if (end !== module.text.length) {
        throw new Error(`Incomplete source mapping: ${module.path}`);
    }
}

function intersectRange(range: SourceRange, segment: SourceRange): SourceRange | null {
    const start = Math.max(range.start, segment.start);
    const end = Math.min(range.end, segment.end);
    const point = range.start === range.end || segment.start === segment.end;
    return start < end || point && start === end ? { start, end } : null;
}

export function mapSourceRange(
    mappings: readonly SourceMapping[],
    range: SourceRange,
    direction: 'generated' | 'original'
): readonly SourceRange[] {
    return mappings.flatMap(function mapSegment(mapping) {
        const source = direction === 'generated' ? mapping.generated : mapping.original;
        const target = direction === 'generated' ? mapping.original : mapping.generated;
        const intersection = intersectRange(range, source);
        if (intersection === null) {
            return [];
        }
        return [
            mapping.kind === 'anchored' ? target : {
                start: target.start + intersection.start - source.start,
                end: target.start + intersection.end - source.start
            }
        ];
    });
}

function preservedMapping(mapping: SourceMapping, range: SourceRange, shift: number): SourceMapping | null {
    const piece = intersectRange(mapping.generated, range);
    if (piece === null || piece.start === piece.end) {
        return null;
    }
    return {
        kind: mapping.kind,
        generated: { start: piece.start + shift, end: piece.end + shift },
        original: mapping.kind === 'anchored' ? mapping.original : {
            start: mapping.original.start + piece.start - mapping.generated.start,
            end: mapping.original.start + piece.end - mapping.generated.start
        }
    };
}

export function replaceMappedText(module: TranslatedModule, range: SourceRange, text: string): TranslatedModule {
    const originalRanges = mapSourceRange(module.mappings, range, 'generated');
    const first = originalRanges[0];
    if (first === undefined) {
        throw new Error(`Unmapped import: ${module.path}`);
    }
    const original = {
        start: Math.min(...originalRanges.map(function start(value) {
            return value.start;
        })),
        end: Math.max(...originalRanges.map(function end(value) {
            return value.end;
        }))
    };
    const shift = text.length - (range.end - range.start);
    const mappings = module.mappings.flatMap(function preserve(mapping) {
        return [
            preservedMapping(mapping, { start: 0, end: range.start }, 0),
            preservedMapping(mapping, { start: range.end, end: module.text.length }, shift)
        ]
            .filter(function present(piece) {
                return piece !== null;
            });
    });
    mappings.push({ kind: 'anchored', original, generated: { start: range.start, end: range.start + text.length } });
    return {
        ...module,
        text: module.text.slice(0, range.start) + text + module.text.slice(range.end),
        mappings: mappings.toSorted(function byPosition(left, right) {
            return left.generated.start - right.generated.start;
        })
    };
}
