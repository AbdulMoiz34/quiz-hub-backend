import mongoose from "mongoose";
import { Attempt } from "../models/attempt.model.js";
import { errorResponse, successResponse } from "../utils/responseHandler.js";

// Hard delete is intentional: it releases the unique {quiz,email} key and
// invalidates every outstanding attempt JWT through the database auth lookup.
export const deleteAttempt = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    return errorResponse(res, 400, "Invalid attempt ID");
  }
  const attempt = await Attempt.findOneAndDelete({ _id: req.params.id })
    .select("quiz email");
  if (!attempt) return errorResponse(res, 404, "Attempt not found");

  res.set("Cache-Control", "no-store");
  return successResponse(res, 200, "Attempt deleted; student may reattempt", {
    attemptId: String(attempt._id),
    quizId: String(attempt.quiz),
    email: attempt.email,
  });
};
