export class CodexError extends Error {
    kind;

    technicalMessage;

    constructor(kind, message, technicalMessage = message) {
        super(message);
        this.name = "CodexError";
        this.kind = kind;
        this.technicalMessage = technicalMessage;
    }
}

export function isCodexError(error) {
    return error instanceof CodexError;
}
