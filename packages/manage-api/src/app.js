import cors from "cors";
import express from "express";
import { createApiTokenMiddleware } from "./auth/apiToken.js";
import { createDocsRouter } from "./routes/docs.js";
import { createHealthRouter } from "./routes/health.js";
import { createSubscribersRouter } from "./routes/subscribers.js";
import { createSoftphoneInternal } from "./services/softphoneInternal.js";

/**
 * @param {{
 *   manageApiToken: string,
 *   corsOrigin: string | string[],
 *   subscribers: import('mongodb').Collection,
 *   softphoneInternalUrl: string,
 *   internalToken: string,
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

  return { app, softphone };
}
