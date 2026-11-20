import { errorResponse } from "../utils/responseHandler.js";

export function errorHandler(error, _req, res, next) {
  if (res.headersSent) return next(error);
  if (error.type === "entity.parse.failed") return errorResponse(res, 400, "Invalid JSON body");
  if (error.type === "entity.too.large") return errorResponse(res, 413, "Request body too large");

  const status = Number(error.statusCode) || 500;
  if (status >= 500) console.error("API request failed:", error);
  return errorResponse(res, status, status >= 500 ? "Internal server error" : error.message);
}
