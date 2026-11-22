import { escapeHtml } from '../html-encoding.ts';

export type SimulationHtmlPage = {
    readonly language: string;
    readonly headMarkup: string;
    readonly bodyMarkup: string;
    readonly stylesheets: readonly string[];
    readonly startupModule: string;
};

function assetAttribute(reference: string, field: string): string {
    const target = URL.parse(reference, 'https://simulation.invalid/');
    if (
        reference.length === 0 || reference !== reference.trim() || /\p{Cc}/u.test(reference) ||
        target === null || ![ 'http:', 'https:' ].includes(target.protocol)
    ) {
        throw new TypeError(`Simulation HTML page ${field} requires a relative or HTTP(S) URL.`);
    }
    return escapeHtml(reference);
}

export function simulationHtmlResponse(page: SimulationHtmlPage): Response {
    const language = escapeHtml(page.language);
    const stylesheets = page
        .stylesheets
        .map(function renderStylesheet(reference, index) {
            const href = assetAttribute(reference, `stylesheets[${index}]`);
            return `<link rel="stylesheet" href="${href}">`;
        })
        .join('');
    const startupModule = assetAttribute(page.startupModule, 'startupModule');
    const document =
        `<!doctype html><html lang="${language}"><head><meta charset="utf-8">${page.headMarkup}${stylesheets}` +
        `</head><body>${page.bodyMarkup}` +
        `<script type="module" src="${startupModule}"></script></body></html>`;
    return new Response(document, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
