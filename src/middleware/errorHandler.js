export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export function notFound(req, _res, next) {
  next(new HttpError(404, "Route not found"));
}

export function errorHandler(err, _req, res, next) {
  if (res.headersSent) return next(err);

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Invalid JSON body" });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ success: false, message: "Request body too large" });
  }

  const status = err instanceof HttpError ? err.statusCode : 500;
  if (status >= 500) console.error("Request error:", err);

  return res.status(status).json({
    success: false,
    message: status >= 500 ? "Internal server error" : err.message,
  });
}
