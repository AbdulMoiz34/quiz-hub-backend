import { Router } from "express";
import authRoutes from "./auth.routes.js";

export default function adminRoutes(config) {
  const router = Router();
  router.use("/auth", authRoutes(config));
  return router;
}
