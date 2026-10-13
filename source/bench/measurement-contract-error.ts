export class MeasurementContractError extends TypeError {
    public constructor(message: string, options: ErrorOptions) {
        super(message, options);
        this.name = 'MeasurementContractError';
    }
}
