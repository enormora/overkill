import type { Linter, Rule } from 'eslint';

const byteOrderMarkCodePoint = 65_279;
const byteOrderMark = String.fromCodePoint(byteOrderMarkCodePoint);

function acceptedFixes(fixes: readonly Rule.Fix[]): readonly Rule.Fix[] {
    const sorted = fixes.toSorted(function rangeOrder(left, right) {
        const start = left.range[0] - right.range[0];
        return start === 0 ? left.range[1] - right.range[1] : start;
    });
    const accepted: Rule.Fix[] = [];
    for (const fix of sorted) {
        const previous = accepted.at(-1);
        if (previous === undefined || fix.range[0] > previous.range[1]) {
            accepted.push(fix);
        }
    }
    return accepted;
}

export function applyRuleEdits(code: string, fixes: readonly Rule.Fix[]): string {
    const bom = code.startsWith(byteOrderMark) ? byteOrderMark : '';
    const accepted = acceptedFixes(fixes);
    const first = accepted[0];
    const changesBom = first !== undefined &&
        (first.range[0] < 0 || first.range[0] === 0 && first.text.startsWith(byteOrderMark));
    const prefix = changesBom ? '' : bom;
    const output = accepted.reduceRight(function edit(value, fix) {
        return value.slice(0, Math.max(0, fix.range[0])) + fix.text + value.slice(fix.range[1]);
    }, code.slice(bom.length));
    return prefix + output;
}

export function applyRuleFixes(code: string, messages: readonly Linter.LintMessage[]): string {
    return applyRuleEdits(
        code,
        messages.flatMap(function edits(message) {
            return message.fix === undefined ? [] : [ message.fix ];
        })
    );
}
