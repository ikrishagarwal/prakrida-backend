export class HttpError extends Error {
  statusCode: number;
  error: object;

  constructor(statusCode: number, message: string, error: object = {}) {
    super();
    this.statusCode = statusCode;
    this.message = message;
    this.error = error;
  }
}
