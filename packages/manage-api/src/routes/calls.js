import { Router } from "express";

/**
 * @param {{
 *   callRecords: import('mongodb').Collection,
 *   requireAuth: import('express').RequestHandler,
 * }} deps
 */
export function createCallsRouter(deps) {
  const { callRecords, requireAuth } = deps;
  const router = Router();

  router.get("/api/manage/calls", requireAuth, async (req, res) => {
    let limit = Number(req.query.limit);
    let offset = Number(req.query.offset);
    if (!Number.isFinite(limit) || limit <= 0) limit = 50;
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    limit = Math.min(limit, 200);

    const [total, docs] = await Promise.all([
      callRecords.countDocuments({}),
      callRecords.find({}).sort({ startedAt: -1 }).skip(offset).limit(limit).toArray(),
    ]);

    return res.json({
      items: docs.map(toPublic),
      total,
      limit,
      offset,
    });
  });

  return router;
}

/** @param {Record<string, any>} doc */
function toPublic(doc) {
  return {
    id: String(doc._id),
    nick: doc.nick,
    direction: doc.direction,
    peer: doc.peer,
    startedAt: doc.startedAt instanceof Date ? doc.startedAt.toISOString() : doc.startedAt,
    answeredAt:
      doc.answeredAt instanceof Date
        ? doc.answeredAt.toISOString()
        : doc.answeredAt || null,
    endedAt:
      doc.endedAt instanceof Date ? doc.endedAt.toISOString() : doc.endedAt || null,
    durationSec: Number(doc.durationSec) || 0,
    ringSec: Number(doc.ringSec) || 0,
    status: doc.status,
    hangupCause: doc.hangupCause || null,
    softphoneOnline: Boolean(doc.softphoneOnline),
  };
}
