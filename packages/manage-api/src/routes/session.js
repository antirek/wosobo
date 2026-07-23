import { randomBytes } from "crypto";
import { Router } from "express";
import { isValidNick, normalizeNick } from "../nicks.js";

const DEFAULT_TTL_SEC = 24 * 60 * 60;

/**
 * @param {{
 *   subscribers: import('mongodb').Collection,
 *   sessions: import('mongodb').Collection,
 *   requireAuth: import('express').RequestHandler,
 *   defaultTtlSec?: number,
 * }} deps
 */
export function createSessionRouter(deps) {
  const { subscribers, sessions, requireAuth } = deps;
  const defaultTtlSec = deps.defaultTtlSec ?? DEFAULT_TTL_SEC;
  const router = Router();

  router.post("/api/manage/subscribers/:nick/session", requireAuth, async (req, res) => {
    const nick = normalizeNick(req.params.nick);
    if (!isValidNick(nick)) {
      return res.status(400).json({ error: "Некорректный ник" });
    }

    const doc = await subscribers.findOne({ nick });
    if (!doc || !doc.enabled) {
      return res.status(404).json({ error: "Абонент не найден или отключён", nick });
    }
    if (!doc.sip?.password) {
      return res.status(404).json({ error: "Абонент без SIP-привязки", nick });
    }

    let ttlSec = Number(req.body?.ttlSec);
    if (!Number.isFinite(ttlSec) || ttlSec <= 0) {
      ttlSec = defaultTtlSec;
    }
    // cap 7d
    ttlSec = Math.min(ttlSec, 7 * 24 * 60 * 60);

    const token = randomBytes(24).toString("hex");
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ttlSec * 1000);
    await sessions.insertOne({ token, nick, createdAt, expiresAt });

    return res.json({
      token,
      nick,
      expiresAt: expiresAt.getTime(),
    });
  });

  return router;
}
