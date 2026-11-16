import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import convertSourceMap from 'convert-source-map';
import { AnyMap } from '@jridgewell/trace-mapping';
import ts from 'typescript';
import { normalizedSourceMap, sourceMapDataSchema, validateSourceMapMappings } from './source-map-data.ts';

export type ImplementationSourceMap = { readonly url: string; readonly source: string; };
type MappedComment = { readonly start: number; readonly end: number; readonly reference: string; };
type DeliveredImplementationSource = {
    readonly source: string;
    readonly sourceMap: ImplementationSourceMap | null;
};

function sourceMapComment(comment: string): string | null {
    const [ , singleLine, multiLine ] = convertSourceMap.mapFileCommentRegex.exec(comment) ?? [];
    return singleLine ?? multiLine ?? null;
}

function sourceMapComments(source: string, url: string): readonly MappedComment[] {
    const file = ts.createSourceFile(url, source, ts.ScriptTarget.Latest, true);
    const comments = new Map<number, MappedComment>();
    function collect(range: Readonly<ts.CommentRange>): void {
        const reference = sourceMapComment(source.slice(range.pos, range.end));
        if (reference !== null) {
            comments.set(range.pos, { reference, start: range.pos, end: range.end });
        }
    }
    function visit(node: ts.Node): void {
        const leading = ts.getLeadingCommentRanges(source, node.pos) ?? [];
        const trailing = ts.getTrailingCommentRanges(source, node.end) ?? [];
        leading.forEach(collect);
        trailing.forEach(collect);
        node.getChildren(file).forEach(visit);
    }
    visit(file);
    return Array.from(comments.values()).toSorted(function byPosition(left, right) {
        return left.start - right.start;
    });
}

function inlineSourceMap(url: Readonly<URL>): string {
    const separator = url.href.indexOf(',');
    const header = url.href.slice(0, separator);
    const payload = url.href.slice(separator + 1);
    return header.endsWith(';base64') ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload);
}

function preservedWhitespace(comment: string): string {
    return comment.replaceAll(/[^\r\n\u{2028}\u{2029}]/gu, function preserveColumns(character) {
        return ' '.repeat(character.length);
    });
}

function immutableMapSource(source: string, comments: readonly MappedComment[], data: string): string {
    let delivered = '';
    let offset = 0;
    for (const comment of comments) {
        delivered += source.slice(offset, comment.start) +
            preservedWhitespace(source.slice(comment.start, comment.end));
        offset = comment.end;
    }
    const encoded = Buffer.from(data).toString('base64');
    return `${delivered}${source.slice(offset)}\n//# sourceMappingURL=data:application/json;base64,${encoded}\n`;
}

export async function deliverImplementationSource(source: string, url: string): Promise<DeliveredImplementationSource> {
    const comments = sourceMapComments(source, url);
    const last = comments.at(-1);
    if (last === undefined) {
        return { source, sourceMap: null };
    }
    const resolved = new URL(last.reference, url);
    const content = resolved.protocol === 'data:'
        ? inlineSourceMap(resolved)
        : await readFile(fileURLToPath(resolved), 'utf8');
    const base = resolved.protocol === 'data:' ? url : resolved.href;
    const map = new AnyMap(sourceMapDataSchema.parse(JSON.parse(content)), base);
    validateSourceMapMappings(map, false);
    return {
        source: immutableMapSource(
            source,
            comments,
            JSON.stringify(normalizedSourceMap(map, map.sourcesContent ?? []))
        ),
        sourceMap: Object.freeze({ url: resolved.href, source: content })
    };
}
