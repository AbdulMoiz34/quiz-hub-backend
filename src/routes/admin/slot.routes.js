import { Router } from "express";
import { adminAuth } from "../../middlewares/auth.middleware.js";
import { validateReq } from "../../middlewares/validateReq.middleware.js";
import { createSlotSchema, updateSlotSchema } from "../../validations/slot.validation.js";
import { listSlots, createSlot, updateSlot } from "../../controllers/slot.controller.js";

export default function slotRoutes(config) {
  const router = Router();
  router.use(adminAuth(config.jwtSecret));

  router.get("/", listSlots);
  router.post("/", validateReq(createSlotSchema), createSlot);
  router.patch("/:id", validateReq(updateSlotSchema), updateSlot);

  return router;
}
