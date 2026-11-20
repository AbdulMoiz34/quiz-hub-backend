import Joi from "joi";

const fields = {
  name: Joi.string().trim().min(2).max(60),
  startsAt: Joi.date().iso(),
  endsAt: Joi.date().iso(),
  capacity: Joi.number().integer().min(1).max(500),
  isActive: Joi.boolean(),
};

function validateSchedule(value, helpers) {
  if (value.startsAt && value.endsAt &&
      new Date(value.endsAt) <= new Date(value.startsAt)) {
    return helpers.message("Slot end time must be after start time");
  }
  return value;
}

export const createSlotSchema = Joi.object({
  quizId: Joi.string().hex().length(24).required(),
  name: fields.name.required(),
  startsAt: fields.startsAt.required(),
  endsAt: fields.endsAt.required(),
  capacity: fields.capacity.default(250),
  isActive: fields.isActive.default(true),
}).custom(validateSchedule);

export const updateSlotSchema = Joi.object({
  name: fields.name,
  startsAt: fields.startsAt,
  endsAt: fields.endsAt,
  capacity: fields.capacity,
  isActive: fields.isActive,
}).min(1).custom(validateSchedule);
