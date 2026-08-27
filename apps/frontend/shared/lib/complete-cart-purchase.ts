import { $createDomain } from "@/clients";
import { callApi } from "@/shared/lib/api-result";
import { clearConfirmedOrder, loadConfirmedOrder } from "@/shared/lib/order-store";

/**
 * カート確認済みの内容があれば、その場で実際にドメインを登録する。
 *
 * アカウントは自己登録ではなく運営側で発行するため、ログイン成功後にここを呼ぶ。
 * 認証自体は成功している前提なので、1件failしても全体を失敗扱いにはしない
 * （failuresを呼び出し側に返し、以降どう見せるかはそちらで判断する）。
 */
export async function completeCartPurchase(): Promise<string[]> {
  const order = loadConfirmedOrder();
  if (!order) return [];

  const failures = await Promise.all(
    order.items.map(async (item) => {
      const fullName = `${item.name}${item.tld}`;
      const result = await callApi(
        $createDomain({ json: { name: fullName, period: { unit: "Y", value: 1 } } }),
      );
      if (result.success) return null;
      return `${fullName}: ${result.error}`;
    }),
  );

  clearConfirmedOrder();
  return failures.filter((failure): failure is string => failure !== null);
}
