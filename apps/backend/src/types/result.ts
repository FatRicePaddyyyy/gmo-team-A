export type Result<T, E = string> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: E };

export type SimpleResult<E = string> =
  | { success: true; error: null }
  | { success: false; error: E };
