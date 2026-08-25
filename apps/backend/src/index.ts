import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { auth } from "./lib/better-auth";
import { authMiddleware } from "./middlewares/auth";
import { corsMiddleware } from "./middlewares/cors";
import { apiKeyAuthMiddleware } from "./middlewares/secret-key";
import { createSeedUserRouteHandler } from "./routes/add-seed-user/post";
import { deleteCategoryRouteHandler } from "./routes/category/delete";
import { getAllCategoriesAndProductsRouteHandler } from "./routes/category/get";
import { createCategoryRouteHandler } from "./routes/category/post";
import { deleteDomainRouteHandler } from "./routes/domains/[domain-id]/delete";
import { getDomainRouteHandler } from "./routes/domains/[domain-id]/get";
import { updateDomainRouteHandler } from "./routes/domains/[domain-id]/put";
import { renewDomainRouteHandler } from "./routes/domains/[domain-id]/renew/post";
import { restoreDomainRouteHandler } from "./routes/domains/[domain-id]/restore/post";
import { approveTransferRouteHandler } from "./routes/domains/[domain-id]/transfer/approve/post";
import { rejectTransferRouteHandler } from "./routes/domains/[domain-id]/transfer/reject/post";
import { checkDomainRouteHandler } from "./routes/domains/check/post";
import { listDomainsRouteHandler } from "./routes/domains/get";
import { createDomainRouteHandler } from "./routes/domains/post";
import { helloRouteHandler } from "./routes/hello/post";
import { cancelTransferRouteHandler } from "./routes/transfers/[transfer-id]/cancel/post";
import { listTransfersRouteHandler } from "./routes/transfers/get";
import { requestTransferRouteHandler } from "./routes/transfers/post";
import { handleTransferPollQueue } from "./scheduled/transfer-poll";
import type { Variables } from "./types";
import type { TransferPollMessage } from "./types/queue";

const app = new OpenAPIHono<{
  Bindings: CloudflareBindings;
  Variables: Variables;
}>();

app.use("/*", corsMiddleware);

app.on(["GET", "POST"], "/api/v1/auth/*", (c) =>
  auth(c.env).handler(c.req.raw),
);

app.use("/api/v1/secret/*", apiKeyAuthMiddleware);
app.use("/api/v1/secure/*", authMiddleware);

export const routes = app
  .route("/", createSeedUserRouteHandler)
  .route("/", helloRouteHandler)
  .route("/", createCategoryRouteHandler)
  .route("/", deleteCategoryRouteHandler)
  .route("/", getAllCategoriesAndProductsRouteHandler)
  .route("/", checkDomainRouteHandler)
  .route("/", createDomainRouteHandler)
  .route("/", listDomainsRouteHandler)
  .route("/", getDomainRouteHandler)
  .route("/", renewDomainRouteHandler)
  .route("/", updateDomainRouteHandler)
  .route("/", deleteDomainRouteHandler)
  .route("/", restoreDomainRouteHandler)
  .route("/", approveTransferRouteHandler)
  .route("/", rejectTransferRouteHandler)
  .route("/", requestTransferRouteHandler)
  .route("/", listTransfersRouteHandler)
  .route("/", cancelTransferRouteHandler);

routes
  .doc("/api", {
    openapi: "3.0.0",
    info: {
      title: "API",
      version: "1.0.0",
    },
  })
  .get(
    "/docs",
    swaggerUI<{ Bindings: CloudflareBindings }>({
      url: "/api",
    }),
  );

export type ApiType = typeof routes;

export default {
  fetch: routes.fetch,
  async queue(batch: MessageBatch<TransferPollMessage>, env: CloudflareBindings): Promise<void> {
    await handleTransferPollQueue(batch, env);
  },
};
