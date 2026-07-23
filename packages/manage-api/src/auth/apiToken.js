import { timingSafeEqual } from "crypto";

/**
 * @param {string} expected
 */
export function createApiTokenMiddleware(expected) {
  const want = Buffer.from(String(expected || ""), "utf8");

  /**
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  return function apiTokenAuth(req, res, next) {
    if (!want.length) {
      return res.status(503).json({ error: "MANAGE_API_TOKEN не задан" });
    }

    const header = req.headers.authorization || "";
    let provided = "";
    if (header.startsWith("Bearer ")) {
      provided = header.slice(7).trim();
    } else if (typeof req.headers["x-api-token"] === "string") {
      provided = req.headers["x-api-token"].trim();
    }

    const got = Buffer.from(provided, "utf8");
    if (got.length !== want.length || !timingSafeEqual(got, want)) {
      return res.status(401).json({ error: "Требуется API token (Bearer или X-Api-Token)" });
    }
    return next();
  };
}
