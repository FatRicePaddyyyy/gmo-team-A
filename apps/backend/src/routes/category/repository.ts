import { eq } from "drizzle-orm";
import type { DBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { products, categories } from "../../lib/schema/general-schema";
import type { Result, SimpleResult } from "../../types/result";

type Category = typeof categories.$inferSelect;
type Product = typeof products.$inferSelect;

export interface CreateCategoryAndProductInput {
  category: {
    name: string;
  };
  products: {
    name: string;
  }[];
}

export interface CategoryWithProducts {
  id: string;
  name: string;
  products: {
    id: string;
    name: string;
    categoryId: string;
  }[];
}

export interface CreatedCategoryAndProducts {
  category: {
    id: string;
    name: string;
  };
  products: {
    id: string;
    name: string;
    categoryId: string;
  }[];
}

export class CategoryRepository {
  static async createCategoryAndProduct(
    input: CreateCategoryAndProductInput,
    db: DBClient,
  ): Promise<Result<CreatedCategoryAndProducts>> {
    try {
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

      // Drizzle の returning() 型上は必ず 1 行返る前提だが、D1 の異常系で 0 件のケースを保険で検知する
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!categoryResult) {
        return { success: false, data: null, error: "category_create_failed" };
      }

      return {
        success: true,
        data: {
          category: categoryResult,
          products: productsResult,
        },
        error: null,
      };
    } catch (error) {
      console.error("CategoryRepository.createCategoryAndProduct error:", error);
      return {
        success: false,
        data: null,
        error: classifyDbError(error),
      };
    }
  }

  static async getAllCategoriesAndProducts(
    db: DBClient,
  ): Promise<Result<{ categories: CategoryWithProducts[] }>> {
    try {
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

      const allCategories: Pick<Category, "id" | "name">[] = batchResponse[0];
      const allProducts: Pick<Product, "id" | "name" | "categoryId">[] = batchResponse[1];

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
      console.error("CategoryRepository.getAllCategoriesAndProducts error:", error);
      return {
        success: false,
        data: null,
        error: classifyDbError(error),
      };
    }
  }

  static async deleteCategory(
    input: { categoryId: string },
    db: DBClient,
  ): Promise<SimpleResult> {
    try {
      await db.batch([
        db.delete(products).where(eq(products.categoryId, input.categoryId)),
        db.delete(categories).where(eq(categories.id, input.categoryId)),
      ]);

      return { success: true, error: null };
    } catch (error) {
      console.error("CategoryRepository.deleteCategory error:", error);
      return { success: false, error: classifyDbError(error) };
    }
  }
}
