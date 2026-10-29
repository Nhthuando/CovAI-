export class ServiceError extends Error {
    constructor(message, statusCode = 500, code, details) {
        super(message);
        this.name = "ServiceError";
        this.statusCode = statusCode;
        if (code) this.code = code;
        if (details !== undefined) this.details = details;
    }
}
