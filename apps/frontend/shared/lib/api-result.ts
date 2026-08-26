/**
 * バックエンドは全エンドポイントで `{ success, data, error }` の封筒を返す。
 * その封筒を剥がして「成功なら data、失敗なら日本語のメッセージ」に揃えるための薄いラップ。
 *
 * エラー文言はバックエンドが `toUserMessage()` で日本語化済みなので、そのまま画面に出せる。
 * 通信自体が落ちた場合だけフロント側の定型文にフォールバックする。
 */

export const NETWORK_ERROR_MESSAGE =
  "通信に失敗しました。時間をおいてもう一度お試しください。";

export type ApiEnvelope<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: string };

export type ApiResult<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: string };

/**
 * `clients.ts` の `$` 付き関数が返す Promise をそのまま渡す。
 * 例外は外に出さないので、呼び出し側は `if (!result.success)` だけ書けばよい。
 */
export async function callApi<T>(
  request: Promise<{ json: () => Promise<ApiEnvelope<T>> }>,
): Promise<ApiResult<T>> {
  try {
    const response = await request;
    const body = await response.json();
    if (!body.success) {
      return {
        success: false,
        data: null,
        error: body.error || NETWORK_ERROR_MESSAGE,
      };
    }
    return { success: true, data: body.data, error: null };
  } catch (caught) {
    console.error("API call failed:", caught);
    return { success: false, data: null, error: NETWORK_ERROR_MESSAGE };
  }
}
