export class UnsupportedEvidenceError extends Error {
    public constructor(message: string, options: Readonly<ErrorOptions> | undefined) {
        super(message, options);
        this.name = 'UnsupportedEvidenceError';
    }
}
