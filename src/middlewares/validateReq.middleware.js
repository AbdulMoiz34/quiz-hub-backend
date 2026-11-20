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
