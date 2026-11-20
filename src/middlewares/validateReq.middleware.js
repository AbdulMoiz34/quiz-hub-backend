import { errorResponse } from "../utils/responseHandler.js";

export const validateReq = (schema) => (req, res, next) => {
  const { value, error } = schema.validate(req.body, {
    abortEarly: false,
    allowUnknown: false,
  });
  if (error) return errorResponse(res, 400, "Invalid request body");
  req.body = value;
  next();
};

// Express 5 exposes req.query through a getter: keep validated values separate.
export const validateQuery = (schema) => (req, res, next) => {
  const { value, error } = schema.validate(req.query, {
    abortEarly: false,
    allowUnknown: false,
  });
  if (error) return errorResponse(res, 400, "Invalid query parameters");
  req.validatedQuery = value;
  next();
};
