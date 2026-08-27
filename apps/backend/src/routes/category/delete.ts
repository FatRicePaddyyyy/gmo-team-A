import { createRoute, z } from "@hono/zod-openapi";
import { createDBClient } from "../../lib/db";
import { toUserMessage } from "../../lib/error-messages";
import { createOpenAPIHono } from "../../lib/openapi-hono";
import { CategoryService } from "./service";

const DeleteCategoryParamsSchema = z
  .object({
    categoryId: z.string().trim().min(1, "カテゴリIDが必要です").openapi({
      example: "cat_123456",
      description: "削除対象のカテゴリID",
    }),
  })
  .openapi("DeleteCategoryParams");

const DeleteProductSuccessResponseSchema = z
  .object({
    success: z.literal(true).openapi({
      description: "削除が成功したことを示します",
    }),
    error: z.null(),
  })
  .openapi("DeleteProductSuccessResponse");

const DeleteProductErrorResponseSchema = z
  .object({
    success: z.literal(false).openapi({
      description: "削除が失敗したことを示します",
    }),
    error: z.string().openapi({
      example: "プロダクトの削除に失敗しました",
      description: "エラーメッセージ",
    }),
  })
  .openapi("DeleteProductErrorResponse");

const deleteCategoryRouteSchema = createRoute({
  method: "delete",
  path: "/api/v1/secure/category/{categoryId}",
  request: {
    params: DeleteCategoryParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: DeleteProductSuccessResponseSchema,
        },
      },
      description: "カテゴリの削除に成功しました",
    },
    500: {
      content: {
        "application/json": {
          schema: DeleteProductErrorResponseSchema,
        },
      },
      description: "サーバーエラーが発生しました",
    },
  },
});

const app = createOpenAPIHono();

export const deleteCategoryRouteHandler = app.openapi(
  deleteCategoryRouteSchema,
  async (ctx) => {
    try {
      const { categoryId } = ctx.req.valid("param");
      const db = createDBClient(ctx.env);

      const result = await CategoryService.delete({ categoryId, db });

      if (!result.success) {
        return ctx.json(
          {
            success: false as const,
            error: toUserMessage(result.error),
          },
          500,
        );
      }

      return ctx.json(
        {
          success: true as const,
          error: null,
        },
        200,
      );
    } catch (error) {
      console.error("Delete category error:", error);
      return ctx.json(
        {
          success: false as const,
          error: "カテゴリの削除中にエラーが発生しました",
        },
        500,
      );
    }
  },
);
