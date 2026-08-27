import type { DBClient } from "../../lib/db";
import type { Result, SimpleResult } from "../../types/result";
import type {
  CategoryWithProducts,
  CreateCategoryAndProductInput,
  CreatedCategoryAndProducts,
} from "./repository";
import { CategoryRepository } from "./repository";

export class CategoryService {
  static async create(input: {
    payload: CreateCategoryAndProductInput;
    db: DBClient;
  }): Promise<Result<CreatedCategoryAndProducts>> {
    return CategoryRepository.createCategoryAndProduct(input.payload, input.db);
  }

  static async getAll(input: {
    db: DBClient;
  }): Promise<Result<{ categories: CategoryWithProducts[] }>> {
    return CategoryRepository.getAllCategoriesAndProducts(input.db);
  }

  static async delete(input: {
    categoryId: string;
    db: DBClient;
  }): Promise<SimpleResult> {
    return CategoryRepository.deleteCategory({ categoryId: input.categoryId }, input.db);
  }
}
