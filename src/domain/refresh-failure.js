export class RefreshFailureError extends Error {
    kind;
    technicalMessage;
    constructor(kind, message, technicalMessage = message) {
        super(message);
        this.name = "RefreshFailureError";
        this.kind = kind;
        this.technicalMessage = technicalMessage;
    }
}
export function isRefreshFailureError(error) {
    return error instanceof RefreshFailureError;
}
