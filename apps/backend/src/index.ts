import { swaggerUI } from "@hono/swagger-ui";
import { auth } from "./lib/better-auth";
import { createOpenAPIHono } from "./lib/openapi-hono";
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
import { listInboundPendingTransfersRouteHandler } from "./routes/domains/pending-inbound-transfers/get";
import { createDomainRouteHandler } from "./routes/domains/post";
import { helloRouteHandler } from "./routes/hello/post";
import { cancelTransferRouteHandler } from "./routes/transfers/[transfer-id]/cancel/post";
import { listTransfersRouteHandler } from "./routes/transfers/get";
import { requestTransferRouteHandler } from "./routes/transfers/post";
import { handleTransferPollQueue } from "./scheduled/transfer-poll";
import { handleTransferPollDlq } from "./scheduled/transfer-poll-dlq";
import { handleTransferSafetyNetCron } from "./scheduled/transfer-safety-net";
import type { TransferPollMessage } from "./types/queue";

const app = createOpenAPIHono();

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
  // 静的パス (/pending-inbound-transfers) は動的パス ({domain-id}) より先に登録する。
  // Hono のルーター実装によっては先勝ちのため、getDomainRouteHandler ({domain-id}) が先だと
  // /pending-inbound-transfers が {domain-id}="pending-inbound-transfers" として吸われる可能性がある。
  .route("/", listInboundPendingTransfersRouteHandler)
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
  // transfer-poll と transfer-poll-dlq の 2 つの consumer を queue 名で分岐する。
  async queue(batch: MessageBatch<TransferPollMessage>, env: CloudflareBindings): Promise<void> {
    if (batch.queue === "transfer-poll-dlq") {
      await handleTransferPollDlq(batch, env);
      return;
    }
    await handleTransferPollQueue(batch, env);
  },
  // R1: safety-net cron。wrangler.jsonc の triggers.crons で 1 時間ごとに発火。
  // Cloudflare Workers spec: 第 1 引数は ScheduledController (scheduledTime プロパティを持つ)。
  async scheduled(controller: ScheduledController, env: CloudflareBindings, _ctx: ExecutionContext): Promise<void> {
    await handleTransferSafetyNetCron(env, new Date(controller.scheduledTime));
  },
};
