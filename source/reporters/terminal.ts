import ansiEscapes from 'ansi-escapes';
import stringWidth from 'string-width';

export type TerminalLineLogger = {
    readonly line: (...values: readonly string[]) => void;
};

export type TerminalLineLoggerDependencies = {
    readonly stdoutConsole: Pick<typeof console, 'log'>;
};

export type TerminalOutput = {
    readonly columns: number;
    readonly off: (event: 'resize', listener: () => void) => unknown;
    readonly on: (event: 'resize', listener: () => void) => unknown;
    readonly write: (text: string) => unknown;
};

export type TerminalProgressRenderer = {
    readonly dispose: () => void;
    readonly finish: () => void;
    readonly writeMark: (mark: string) => void;
};

export type TerminalProgressRendererDependencies = {
    readonly interactive: boolean;
    readonly output: TerminalOutput;
};

type ProgressBlock = {
    readonly lastLineWidth: number;
    readonly lineCount: number;
    readonly text: string;
};

type ProgressBlockDraft = {
    readonly lastLineWidth: number;
    readonly lines: readonly string[];
};

const fallbackColumns = 80;

export function createTerminalLineLogger(dependencies: TerminalLineLoggerDependencies): TerminalLineLogger {
    const { stdoutConsole } = dependencies;

    return {
        line(...values) {
            stdoutConsole.log(...values);
        }
    };
}

function terminalColumns(output: Pick<TerminalOutput, 'columns'>): number {
    return Number.isSafeInteger(output.columns) && output.columns > 0 ? output.columns : fallbackColumns;
}

export function visibleTerminalWidth(value: string): number {
    return stringWidth(value);
}

function emptyProgressBlock(): ProgressBlock {
    return {
        lastLineWidth: 0,
        lineCount: 0,
        text: ''
    };
}

function firstProgressBlockDraft(): ProgressBlockDraft {
    return {
        lastLineWidth: 0,
        lines: [ '' ]
    };
}

function progressMarkNeedsWrap(lineWidth: number, markWidth: number, columns: number): boolean {
    return lineWidth > 0 && lineWidth + markWidth > columns;
}

function appendMarkToDraft(draft: ProgressBlockDraft, mark: string, columns: number): ProgressBlockDraft {
    const markWidth = visibleTerminalWidth(mark);

    if (progressMarkNeedsWrap(draft.lastLineWidth, markWidth, columns)) {
        return {
            lastLineWidth: markWidth,
            lines: [ ...draft.lines, mark ]
        };
    }

    const leadingLines = draft.lines.slice(0, -1);
    const currentLine = draft.lines.at(-1) ?? '';

    return {
        lastLineWidth: draft.lastLineWidth + markWidth,
        lines: [ ...leadingLines, `${currentLine}${mark}` ]
    };
}

function progressBlockFromDraft(draft: ProgressBlockDraft): ProgressBlock {
    return {
        lastLineWidth: draft.lastLineWidth,
        lineCount: draft.lines.length,
        text: draft.lines.join('\n')
    };
}

function renderProgressBlock(marks: readonly string[], columns: number): ProgressBlock {
    return marks.length === 0
        ? emptyProgressBlock()
        : progressBlockFromDraft(marks.reduce(function appendMark(draft, mark) {
            return appendMarkToDraft(draft, mark, columns);
        }, firstProgressBlockDraft()));
}

function eraseProgressBlock(lineCount: number): string {
    if (lineCount === 0) {
        return '';
    }

    return ansiEscapes.eraseLines(lineCount);
}

function nextProgressBlock(currentBlock: ProgressBlock, mark: string, columns: number): ProgressBlock {
    const markWidth = visibleTerminalWidth(mark);
    const needsWrap = progressMarkNeedsWrap(currentBlock.lastLineWidth, markWidth, columns);

    return {
        lastLineWidth: needsWrap ? markWidth : currentBlock.lastLineWidth + markWidth,
        lineCount: currentBlock.lineCount === 0 ? 1 : currentBlock.lineCount + (needsWrap ? 1 : 0),
        text: ''
    };
}

function writeProgressMark(output: TerminalOutput, currentBlock: ProgressBlock, mark: string): ProgressBlock {
    const markWidth = visibleTerminalWidth(mark);
    const needsWrap = progressMarkNeedsWrap(currentBlock.lastLineWidth, markWidth, terminalColumns(output));
    const prefix = needsWrap ? '\n' : '';

    output.write(`${prefix}${mark}`);

    return nextProgressBlock(currentBlock, mark, terminalColumns(output));
}

export function createTerminalProgressRenderer(
    dependencies: TerminalProgressRendererDependencies
): TerminalProgressRenderer {
    const { interactive, output } = dependencies;
    let currentBlock = emptyProgressBlock();
    let disposed = false;
    let finished = false;
    let marks: readonly string[] = [];

    function redrawProgressBlock(): void {
        if (!interactive || finished || marks.length === 0) {
            return;
        }

        const nextBlock = renderProgressBlock(marks, terminalColumns(output));
        output.write(`${eraseProgressBlock(currentBlock.lineCount)}${nextBlock.text}`);
        currentBlock = nextBlock;
    }

    function resizeTerminal(): void {
        redrawProgressBlock();
    }

    if (interactive) {
        output.on('resize', resizeTerminal);
    }

    return {
        dispose() {
            if (disposed) {
                return;
            }

            disposed = true;
            if (interactive) {
                output.off('resize', resizeTerminal);
            }
        },

        finish() {
            if (finished) {
                return;
            }

            finished = true;
            if (currentBlock.lastLineWidth > 0) {
                output.write('\n');
            }
        },

        writeMark(mark) {
            if (finished) {
                output.write(mark);

                return;
            }

            marks = [ ...marks, mark ];
            currentBlock = writeProgressMark(output, currentBlock, mark);
        }
    };
}
