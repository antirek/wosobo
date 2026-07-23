import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openapiPath = path.join(__dirname, "..", "..", "openapi", "openapi.yaml");

export function loadOpenApiDocument() {
  const raw = fs.readFileSync(openapiPath, "utf8");
  const document = YAML.parse(raw);
  const serverUrl = process.env.OPENAPI_SERVER_URL || "/manage-api";
  document.servers = [{ url: serverUrl, description: "API base" }];
  return document;
}

export function createDocsRouter() {
  const document = loadOpenApiDocument();
  const router = Router();

  router.get("/api/manage/openapi.json", (_req, res) => {
    res.json(document);
  });

  router.use(
    "/api/manage/docs",
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: "Manage API",
      swaggerOptions: {
        persistAuthorization: true,
      },
    }),
  );

  return router;
}
