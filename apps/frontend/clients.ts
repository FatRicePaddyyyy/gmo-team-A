import { hc } from "hono/client";
import type { InferResponseType, InferRequestType } from "hono/client";
import type { ApiType } from "backend";

const client = (baseUrl: string) =>
  hc<ApiType>(baseUrl, {
    init: {
      credentials: "include",
    },
  }).api.v1;

export const $getHello = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.hello.$post;
export type GetHelloRequest = InferRequestType<typeof $getHello>;
export type GetHelloResponse = InferResponseType<typeof $getHello>;

export const $getAllCategoriesAndProducts = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.category.$get;
export type getAllCategoriesAndProductsResponse = InferResponseType<
  typeof $getAllCategoriesAndProducts
>;

export const $deleteCategory = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.category[":categoryId"].$delete;
export type DeleteCategoryRequest = InferRequestType<typeof $deleteCategory>;
export type DeleteCategoryResponse = InferResponseType<typeof $deleteCategory>;
