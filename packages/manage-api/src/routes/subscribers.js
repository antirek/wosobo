import { Router } from "express";
import { isValidNick, normalizeNick } from "../nicks.js";
import { parseSipWrite, toPublic } from "../subscribers.js";

/**
 * @param {{
 *   subscribers: import('mongodb').Collection,
 *   softphone: ReturnType<import('../services/softphoneInternal.js').createSoftphoneInternal>,
 *   requireAuth: import('express').RequestHandler,
 * }} deps
 */
export function createSubscribersRouter(deps) {
  const { subscribers, softphone, requireAuth } = deps;
  const router = Router();

  router.get("/api/manage/subscribers", requireAuth, async (_req, res) => {
    const docs = await subscribers.find({}).sort({ nick: 1 }).toArray();
    const statuses = await softphone.fetchLineStatuses();
    res.json({
      items: docs.map((doc) => softphone.withRuntime(doc, statuses.get(doc.nick), toPublic)),
    });
  });

  router.get("/api/manage/subscribers/:nick", requireAuth, async (req, res) => {
    const nick = normalizeNick(req.params.nick);
    if (!isValidNick(nick)) {
      return res.status(400).json({ error: "Некорректный ник" });
    }
    const doc = await subscribers.findOne({ nick });
    if (!doc) {
      return res.status(404).json({ error: "Не найден", nick });
    }
    const statuses = await softphone.fetchLineStatuses();
    return res.json(softphone.withRuntime(doc, statuses.get(nick), toPublic));
  });

  router.put("/api/manage/subscribers/:nick", requireAuth, async (req, res) => {
    const nick = normalizeNick(req.params.nick);
    if (!isValidNick(nick)) {
      return res.status(400).json({ error: "Некорректный ник (латиница, цифры, ._-, 1–32)" });
    }

    const existing = await subscribers.findOne({ nick });
    const parsed = parseSipWrite(req.body, { requirePassword: !existing?.sip?.password });
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const displayName =
      req.body.displayName != null ? String(req.body.displayName).trim() : existing?.displayName || nick;
    const enabled = req.body.enabled != null ? Boolean(req.body.enabled) : existing?.enabled ?? true;
    const absentAnnounce =
      req.body.absentAnnounce != null
        ? Boolean(req.body.absentAnnounce)
        : Boolean(existing?.absentAnnounce);

    /** @type {Record<string, unknown>} */
    const sip = { ...(existing?.sip || {}), ...parsed.sip };
    if (!sip.password && existing?.sip?.password) {
      sip.password = existing.sip.password;
    }
    if (!sip.password) {
      return res.status(400).json({ error: "Нужен sip.password" });
    }

    const now = new Date();
    await subscribers.updateOne(
      { nick },
      {
        $set: {
          nick,
          displayName,
          enabled,
          absentAnnounce,
          sip,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );

    const doc = await subscribers.findOne({ nick });
    await softphone.notifyReconcile({ nick });
    return res.json(toPublic(doc));
  });

  router.patch("/api/manage/subscribers/:nick", requireAuth, async (req, res) => {
    const nick = normalizeNick(req.params.nick);
    if (!isValidNick(nick)) {
      return res.status(400).json({ error: "Некорректный ник" });
    }
    const existing = await subscribers.findOne({ nick });
    if (!existing) {
      return res.status(404).json({ error: "Не найден", nick });
    }

    /** @type {Record<string, unknown>} */
    const $set = { updatedAt: new Date() };
    if (req.body.displayName != null) {
      $set.displayName = String(req.body.displayName).trim();
    }
    if (req.body.enabled != null) {
      $set.enabled = Boolean(req.body.enabled);
    }
    if (req.body.absentAnnounce != null) {
      $set.absentAnnounce = Boolean(req.body.absentAnnounce);
    }
    if (req.body.sip && typeof req.body.sip === "object") {
      const parsed = parseSipWrite({ sip: req.body.sip }, { requirePassword: false });
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      const sip = { ...existing.sip, ...parsed.sip };
      if (!parsed.sip.password) {
        sip.password = existing.sip.password;
      }
      $set.sip = sip;
    }

    await subscribers.updateOne({ nick }, { $set });
    const doc = await subscribers.findOne({ nick });
    await softphone.notifyReconcile({ nick });
    return res.json(toPublic(doc));
  });

  router.delete("/api/manage/subscribers/:nick", requireAuth, async (req, res) => {
    const nick = normalizeNick(req.params.nick);
    if (!isValidNick(nick)) {
      return res.status(400).json({ error: "Некорректный ник" });
    }
    const result = await subscribers.deleteOne({ nick });
    if (!result.deletedCount) {
      return res.status(404).json({ error: "Не найден", nick });
    }
    await softphone.notifyReconcile({ nick });
    return res.json({ ok: true });
  });

  return router;
}
