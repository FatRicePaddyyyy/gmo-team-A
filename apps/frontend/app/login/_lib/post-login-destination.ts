import { loadConfirmedOrder } from "@/shared/lib/order-store";

/**
 * ログインを終えた人を、次にどこへ送るか。
 *
 * 「ログインに成功した直後」と「すでにログイン済みで /login を開いた」の
 * 2 経路から呼ばれる。片方だけ直すと行き先が食い違うので、規則はここ 1 箇所に置く（Issue #151）。
 *
 * 申し込みを確定させた人は支払いの途中なので、そこへ戻す。
 * そうでない人はマイドメインを見に来ているはずなので、そちらへ送る。
 */
export function postLoginDestination(): string {
  return loadConfirmedOrder() ? "/cart/payment" : "/dashboard";
}
