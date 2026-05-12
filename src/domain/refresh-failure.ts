export type RefreshFailureKind =
    | "missing-auth"
    | "unauthorized"
    | "network"
    | "malformed-response"
    | "unexpected-response";

export class RefreshFailureError extends Error {
    kind: RefreshFailureKind;
    technicalMessage: string;

    constructor(kind: RefreshFailureKind, message: string, technicalMessage = message) {
        super(message);
        this.name = "RefreshFailureError";
        this.kind = kind;
        this.technicalMessage = technicalMessage;
    }
}

export function isRefreshFailureError(error: unknown): error is RefreshFailureError {
    return error instanceof RefreshFailureError;
}
