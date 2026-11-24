/** An error with an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(status, code, message, details = undefined, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }

  static badRequest(message, details) {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'Access denied') {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(code, message) {
    return new ApiError(404, code, message);
  }

  static conflict(code, message) {
    return new ApiError(409, code, message);
  }

  static serviceUnavailable(code, message) {
    return new ApiError(503, code, message);
  }
}
