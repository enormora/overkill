export type SourceRange = { readonly start: number; readonly end: number; };
export type SourceMapping = {
    readonly generated: SourceRange;
    readonly original: SourceRange;
    readonly kind: 'anchored' | 'copied';
};
type CopiedFragment = { readonly kind: 'copied'; readonly original: SourceRange; };
type AnchoredFragment = { readonly kind: 'anchored'; readonly original: SourceRange; readonly text: string; };
export type SourceFragment = AnchoredFragment | CopiedFragment;

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
    if (range.start === range.end) {
        return start === end ? { start, end } : null;
    }
    return start < end ? { start, end } : null;
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

export function replaceMappedSource(
    module: TranslatedModule,
    range: SourceRange,
    fragments: readonly SourceFragment[]
): TranslatedModule {
    validateRange(range, module.text.length);
    let offset = range.start;
    const mappings: SourceMapping[] = [];
    const text = fragments
        .map(function render(fragment) {
            validateRange(fragment.original, module.originalText.length);
            const value = fragment.kind === 'copied'
                ? module.originalText.slice(fragment.original.start, fragment.original.end)
                : fragment.text;
            if (value.length > 0) {
                mappings.push({
                    kind: fragment.kind,
                    original: fragment.original,
                    generated: { start: offset, end: offset + value.length }
                });
            }
            offset += value.length;
            return value;
        })
        .join('');
    const shift = text.length - (range.end - range.start);
    const preserved = module.mappings.flatMap(function preserve(mapping) {
        return [
            preservedMapping(mapping, { start: 0, end: range.start }, 0),
            preservedMapping(mapping, { start: range.end, end: module.text.length }, shift)
        ]
            .filter(function present(piece) {
                return piece !== null;
            });
    });
    const result = {
        ...module,
        text: module.text.slice(0, range.start) + text + module.text.slice(range.end),
        mappings: [ ...preserved, ...mappings ].toSorted(function byPosition(left, right) {
            return left.generated.start - right.generated.start;
        })
    };
    validateMappings(result);
    return result;
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
    return replaceMappedSource(module, range, [ { kind: 'anchored', original, text } ]);
}
