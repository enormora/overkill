import { structuredPatch } from 'diff';
import type { Hunk } from './diff-shape.ts';

function addedLines(lines: readonly string[]): readonly string[] {
    return lines.flatMap(function added(line) {
        return line.startsWith('+') && !line.startsWith('+++') ? [ line.slice(1) ] : [];
    });
}

function removedLines(lines: readonly string[]): readonly string[] {
    return lines.flatMap(function removed(line) {
        return line.startsWith('-') && !line.startsWith('---') ? [ line.slice(1) ] : [];
    });
}

export function createStringHunks(expected: string, actual: string): readonly Hunk[] {
    return structuredPatch('expected', 'actual', expected, actual, '', '', { context: 2 }).hunks.map(
        function toHunk(hunk) {
            return {
                actualStart: hunk.newStart,
                added: addedLines(hunk.lines),
                expectedStart: hunk.oldStart,
                removed: removedLines(hunk.lines)
            };
        }
    );
}
