import { Router } from "express";

export function createHealthRouter() {
  const router = Router();
  router.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "manage-api" });
  });
  return router;
}
