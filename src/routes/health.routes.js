import { Router } from "express";

export function createHealthRouter({ isDbReady }) {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ success: true, status: "ok" });
  });

  router.get("/ready", (_req, res) => {
    res.set("Cache-Control", "no-store");
    const ready = isDbReady();
    res.status(ready ? 200 : 503).json({
      success: ready,
      status: ready ? "ready" : "not_ready",
    });
  });

  return router;
}
