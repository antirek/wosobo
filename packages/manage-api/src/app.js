import cors from "cors";
import express from "express";
import { createApiTokenMiddleware } from "./auth/apiToken.js";
import { createDocsRouter } from "./routes/docs.js";
import { createHealthRouter } from "./routes/health.js";
import { createSubscribersRouter } from "./routes/subscribers.js";
import { createSessionRouter } from "./routes/session.js";
import { createCallsRouter } from "./routes/calls.js";
import { createSoftphoneInternal } from "./services/softphoneInternal.js";

/**
 * @param {{
 *   manageApiToken: string,
 *   corsOrigin: string | string[],
 *   subscribers: import('mongodb').Collection,
 *   sessions: import('mongodb').Collection,
 *   callRecords: import('mongodb').Collection,
 *   softphoneInternalUrl: string,
 *   internalToken: string,
 *   sessionTtlSec?: number,
 * }} opts
 */
export function createApp(opts) {
  const app = express();
  app.use(
    cors({
      origin: Array.isArray(opts.corsOrigin)
        ? opts.corsOrigin
        : opts.corsOrigin,
    }),
  );
  app.use(express.json());

  const requireAuth = createApiTokenMiddleware(opts.manageApiToken);
  const softphone = createSoftphoneInternal({
    softphoneInternalUrl: opts.softphoneInternalUrl,
    internalToken: opts.internalToken,
  });

  app.use(createHealthRouter());
  app.use(createDocsRouter());
  app.use(
    createSubscribersRouter({
      subscribers: opts.subscribers,
      softphone,
      requireAuth,
    }),
  );
  app.use(
    createSessionRouter({
      subscribers: opts.subscribers,
      sessions: opts.sessions,
      requireAuth,
      defaultTtlSec: opts.sessionTtlSec,
    }),
  );
  app.use(
    createCallsRouter({
      callRecords: opts.callRecords,
      requireAuth,
    }),
  );

  return { app, softphone };
}
