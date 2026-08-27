/**
 * バックエンドは全エンドポイントで `{ success, data, error }` の封筒を返す。
 * その封筒を剥がして「成功なら data、失敗なら日本語のメッセージ」に揃えるための薄いラップ。
 *
 * エラー文言はバックエンドが `toUserMessage()` で日本語化済みなので、そのまま画面に出せる。
 * 通信自体が落ちた場合だけフロント側の定型文にフォールバックする。
 */

export const NETWORK_ERROR_MESSAGE =
  "通信に失敗しました。時間をおいてもう一度お試しください。";

/**
 * セッション切れ（401）のときの文言。
 * バックエンドも日本語を返すが、フロントからは「ログインし直す」導線を出したいので、
 * 401 だけは呼び出し側が判別できるようにしている。
 */
export const SESSION_EXPIRED_MESSAGE =
  "ログインの有効期限が切れました。もう一度ログインしてください。";

export type ApiEnvelope<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: string };

export type ApiResult<T> =
  | { success: true; data: T; error: null; unauthorized?: false }
  | { success: false; data: null; error: string; unauthorized: boolean };

/**
 * `clients.ts` の `$` 付き関数が返す Promise をそのまま渡す。
 * 例外は外に出さないので、呼び出し側は `if (!result.success)` だけ書けばよい。
 *
 * 401 のときは `unauthorized: true` を立てる。画面側はこれを見て
 * 「ログインページへ」の導線を出す（`FeedbackBanner` の action など）。
 */
export async function callApi<T>(
  request: Promise<{ json: () => Promise<ApiEnvelope<T>>; status?: number }>,
): Promise<ApiResult<T>> {
  try {
    const response = await request;
    if (response.status === 401) {
      return {
        success: false,
        data: null,
        error: SESSION_EXPIRED_MESSAGE,
        unauthorized: true,
      };
    }
    const body = await response.json();
    if (!body.success) {
      return {
        success: false,
        data: null,
        error: body.error || NETWORK_ERROR_MESSAGE,
        unauthorized: false,
      };
    }
    return { success: true, data: body.data, error: null };
  } catch (caught) {
    console.error("API call failed:", caught);
    return {
      success: false,
      data: null,
      error: NETWORK_ERROR_MESSAGE,
      unauthorized: false,
    };
  }
}
