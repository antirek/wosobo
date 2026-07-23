import { ObjectId } from "mongodb";

const DEFAULT_TTL_SEC = 2 * 24 * 60 * 60;

/**
 * Mongo CDR store for softphone calls.
 * @param {import('mongodb').Collection} col
 * @param {{ ttlSec?: number, log?: (s: string) => void }} [opts]
 */
export function createCallCdrStore(col, opts = {}) {
  const ttlSec = Number(opts.ttlSec) > 0 ? Number(opts.ttlSec) : DEFAULT_TTL_SEC;
  const log = opts.log || (() => {});

  async function ensureIndexes() {
    try {
      await col.createIndex({ startedAt: 1 }, { expireAfterSeconds: ttlSec });
    } catch (err) {
      // Index may exist with different TTL — drop & recreate
      log(`call_records TTL index: ${err.message || err}; recreating`);
      try {
        await col.dropIndex("startedAt_1");
      } catch {
        /* ignore */
      }
      await col.createIndex({ startedAt: 1 }, { expireAfterSeconds: ttlSec });
    }
    await col.createIndex({ startedAt: -1 });
  }

  /**
   * @param {{
   *   nick: string,
   *   direction: 'in' | 'out',
   *   peer?: string,
   *   status: string,
   *   softphoneOnline?: boolean,
   * }} p
   * @returns {Promise<string | null>}
   */
  async function begin(p) {
    try {
      const now = new Date();
      const doc = {
        nick: p.nick,
        direction: p.direction,
        peer: String(p.peer || "unknown").slice(0, 128) || "unknown",
        startedAt: now,
        answeredAt: null,
        endedAt: null,
        durationSec: 0,
        ringSec: 0,
        status: p.status,
        hangupCause: null,
        softphoneOnline: Boolean(p.softphoneOnline),
        updatedAt: now,
      };
      const r = await col.insertOne(doc);
      return String(r.insertedId);
    } catch (err) {
      log(`cdr begin: ${err.message || err}`);
      return null;
    }
  }

  /**
   * @param {string | null} id
   * @param {Record<string, unknown>} fields
   */
  async function patch(id, fields) {
    if (!id) return;
    try {
      const _id = new ObjectId(id);
      const set = { ...fields, updatedAt: new Date() };
      await col.updateOne({ _id, endedAt: null }, { $set: set });
    } catch (err) {
      log(`cdr patch: ${err.message || err}`);
    }
  }

  /**
   * @param {string | null} id
   * @param {{
   *   status: string,
   *   hangupCause?: string | null,
   *   answeredAt?: Date | null,
   *   startedAt?: Date | null,
   * }} p
   */
  async function end(id, p) {
    if (!id) return;
    try {
      const _id = new ObjectId(id);
      const now = new Date();
      const existing = await col.findOne({ _id });
      if (!existing || existing.endedAt) return;

      const startedAt = existing.startedAt instanceof Date ? existing.startedAt : now;
      const answeredAt =
        p.answeredAt instanceof Date
          ? p.answeredAt
          : existing.answeredAt instanceof Date
            ? existing.answeredAt
            : null;

      const ringEnd = answeredAt || now;
      const ringSec = Math.max(0, Math.round((ringEnd.getTime() - startedAt.getTime()) / 1000));
      const durationSec = answeredAt
        ? Math.max(0, Math.round((now.getTime() - answeredAt.getTime()) / 1000))
        : 0;

      await col.updateOne(
        { _id, endedAt: null },
        {
          $set: {
            status: p.status,
            hangupCause: p.hangupCause != null ? String(p.hangupCause).slice(0, 256) : null,
            answeredAt,
            endedAt: now,
            durationSec,
            ringSec,
            updatedAt: now,
          },
        },
      );
    } catch (err) {
      log(`cdr end: ${err.message || err}`);
    }
  }

  return { ensureIndexes, begin, patch, end, ttlSec };
}
