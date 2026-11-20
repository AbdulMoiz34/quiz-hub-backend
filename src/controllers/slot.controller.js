import mongoose from "mongoose";
import { Quiz } from "../models/quiz.model.js";
import { Slot } from "../models/slot.model.js";
import { errorResponse, successResponse } from "../utils/responseHandler.js";

const validId = (id) => mongoose.isObjectIdOrHexString(id);

const hasOverlap = (quiz, startsAt, endsAt, excludeId) => Slot.exists({
  quiz,
  ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  startsAt: { $lt: endsAt },
  endsAt: { $gt: startsAt },
});

export const listSlots = async (req, res) => {
  const { quizId } = req.query;
  if (!validId(quizId)) return errorResponse(res, 400, "Valid quizId is required");

  const slots = await Slot.find({ quiz: quizId })
    .select("quiz name startsAt endsAt capacity isActive createdAt")
    .sort({ startsAt: 1 })
    .lean();

  return successResponse(res, 200, "Exam slots fetched", slots);
};

export const createSlot = async (req, res) => {
  const { quizId, name, startsAt, endsAt, capacity, isActive } = req.body;
  const start = new Date(startsAt);
  const end = new Date(endsAt);

  if (start <= new Date()) return errorResponse(res, 400, "Slot must start in the future");
  if (!(await Quiz.exists({ _id: quizId }))) {
    return errorResponse(res, 404, "Quiz not found");
  }
  if (await hasOverlap(quizId, start, end)) {
    return errorResponse(res, 409, "This quiz already has a slot during those times");
  }

  try {
    const slot = await Slot.create({
      quiz: quizId, name, startsAt: start, endsAt: end, capacity, isActive,
    });
    return successResponse(res, 201, "Exam slot created", slot);
  } catch (error) {
    if (error.code === 11000) {
      return errorResponse(res, 409, "A slot with this name already exists for this quiz");
    }
    throw error;
  }
};

export const updateSlot = async (req, res) => {
  if (!validId(req.params.id)) return errorResponse(res, 400, "Invalid slot ID");

  const slot = await Slot.findById(req.params.id);
  if (!slot) return errorResponse(res, 404, "Slot not found");
  if (slot.startsAt <= new Date()) {
    return errorResponse(res, 409, "A started or finished slot cannot be edited");
  }

  const startsAt = new Date(req.body.startsAt || slot.startsAt);
  const endsAt = new Date(req.body.endsAt || slot.endsAt);
  if (endsAt <= startsAt) return errorResponse(res, 400, "Slot end time must be after start time");
  if (startsAt <= new Date()) return errorResponse(res, 400, "Slot must start in the future");
  if (await hasOverlap(slot.quiz, startsAt, endsAt, slot._id)) {
    return errorResponse(res, 409, "This quiz already has a slot during those times");
  }

  try {
    const updated = await Slot.findOneAndUpdate(
      { _id: slot._id, startsAt: { $gt: new Date() } },
      { $set: req.body },
      { returnDocument: "after", runValidators: true }
    );
    if (!updated) return errorResponse(res, 409, "Slot already started");
    return successResponse(res, 200, "Exam slot updated", updated);
  } catch (error) {
    if (error.code === 11000) {
      return errorResponse(res, 409, "A slot with this name already exists for this quiz");
    }
    throw error;
  }
};
