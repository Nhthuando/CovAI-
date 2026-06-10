export class ServiceError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.name = "ServiceError";
        this.statusCode = statusCode;
    }
}
