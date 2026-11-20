import Joi from "joi";

export const violationSchema = Joi.object({
  eventId: Joi.string().guid({ version: "uuidv4" }).required(),
  type: Joi.string().valid("tab_hidden", "window_blur").required(),
});
