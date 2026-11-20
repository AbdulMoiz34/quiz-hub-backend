import mongoose from "mongoose";
import { Attempt } from "../models/attempt.model.js";
import { errorResponse, successResponse } from "../utils/responseHandler.js";

// Delete an individual attempt (including answers and scores) to allow
// another attempt for the same quiz/email. All data is on one document.
// The previous signed cookie becomes invalid because attemptAuth checks DB.
export const deleteAttempt = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    return errorResponse(res, 400, "Invalid attempt ID");
  }
  const deleted = await Attempt.findByIdAndDelete(req.params.id).select("_id");
  if (!deleted) return errorResponse(res, 404, "Attempt not found");
  return successResponse(res, 200, "Attempt deleted. Student may start again.", {
    id: String(deleted._id),
  });
};
