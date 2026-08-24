import { eq } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
import { products, categories } from "../../lib/schema/general-schema";

export interface CreateCategoryAndProductInput {
  category: {
    name: string;
  };
  products: {
    name: string;
  }[];
}

export type CreateCategoryAndProductResponse =
  | {
      success: true;
      data: {
        category: {
          id: string;
          name: string;
        };
        products: {
          id: string;
          name: string;
          categoryId: string;
        }[];
      };
      error: null;
    }
  | {
      success: false;
      data: null;
      error: string;
    };

export interface DeleteProductInput {
  productId: string;
}

export interface DeleteCategoryInput {
  categoryId: string;
}

export type GetAllCategoriesAndProductsResponse =
  | {
      success: true;
      data: {
        categories: {
          id: string;
          name: string;
          products: {
            id: string;
            name: string;
            categoryId: string;
          }[];
        }[];
      };
      error: null;
    }
  | {
      success: false;
      data: null;
      error: string;
    };

export class ProductRepository {
  static async createCategoryAndProduct(
    input: CreateCategoryAndProductInput,
    env: CloudflareBindings,
  ): Promise<CreateCategoryAndProductResponse> {
    try {
      const db = createDBClient(env);
      const categoryId = crypto.randomUUID();

      const batchResponse = await db.batch([
        db
          .insert(categories)
          .values({
            id: categoryId,
            name: input.category.name,
          })
          .returning({
            id: categories.id,
            name: categories.name,
          }),
        db
          .insert(products)
          .values(
            input.products.map((product) => ({
              name: product.name,
              categoryId,
            })),
          )
          .returning({
            id: products.id,
            name: products.name,
            categoryId: products.categoryId,
          }),
      ]);

      const categoryResult = batchResponse[0][0];
      const productsResult = batchResponse[1];

      return {
        success: true,
        data: {
          category: categoryResult,
          products: productsResult,
        },
        error: null,
      };
    } catch (error) {
      console.error("カテゴリ・プロダクト作成エラー:", error);

      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : "不明なエラー",
      };
    }
  }

  static async getAllCategoriesAndProducts(
    env: CloudflareBindings,
  ): Promise<GetAllCategoriesAndProductsResponse> {
    try {
      const db = createDBClient(env);

      const batchResponse = await db.batch([
        db
          .select({
            id: categories.id,
            name: categories.name,
          })
          .from(categories),
        db
          .select({
            id: products.id,
            name: products.name,
            categoryId: products.categoryId,
          })
          .from(products),
      ]);

      const allCategories = batchResponse[0];
      const allProducts = batchResponse[1];

      const categoriesWithProducts = allCategories.map((category) => ({
        id: category.id,
        name: category.name,
        products: allProducts.filter(
          (product) => product.categoryId === category.id,
        ),
      }));

      return {
        success: true,
        data: {
          categories: categoriesWithProducts,
        },
        error: null,
      };
    } catch (error) {
      console.error("カテゴリ・プロダクト取得エラー:", error);

      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : "不明なエラー",
      };
    }
  }

  static async deleteProduct(
    input: DeleteProductInput,
    env: CloudflareBindings,
  ) {
    try {
      const db = createDBClient(env);
      await db.batch([
        db
          .select({
            id: products.id,
            name: products.name,
            categoryId: products.categoryId,
          })
          .from(products)
          .where(eq(products.id, input.productId)),
        db.delete(products).where(eq(products.id, input.productId)),
      ]);

      return { success: true };
    } catch (error) {
      console.error("プロダクト削除エラー:", error);
      return { success: false };
    }
  }

  static async deleteCategory(
    input: DeleteCategoryInput,
    env: CloudflareBindings,
  ) {
    try {
      const db = createDBClient(env);

      await db.batch([
        db.delete(products).where(eq(products.categoryId, input.categoryId)),
        db.delete(categories).where(eq(categories.id, input.categoryId)),
      ]);

      return { success: true };
    } catch (error) {
      console.error("カテゴリ削除エラー:", error);
      return { success: false };
    }
  }
}
