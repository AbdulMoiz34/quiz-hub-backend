import { Router } from "express";
import { adminAuth } from "../../middlewares/auth.middleware.js";
import { validateQuery } from "../../middlewares/validateReq.middleware.js";
import {
  listResultsSchema, exportResultsSchema, resultsStatsSchema,
} from "../../validations/results.validation.js";
import {
  listResults, resultsStats, exportResults,
} from "../../controllers/results.controller.js";

export default function resultsRoutes(config) {
  const router = Router();
  router.use(adminAuth(config.jwtSecret));

  router.get("/stats", validateQuery(resultsStatsSchema), resultsStats);
  router.get("/export", validateQuery(exportResultsSchema), exportResults);
  router.get("/", validateQuery(listResultsSchema), listResults);

  return router;
}
