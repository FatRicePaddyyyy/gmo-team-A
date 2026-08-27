export type PaymentMethod = "credit-card" | "konbini" | "bank-transfer";

export interface PaymentMethodOption {
  id: PaymentMethod;
  label: string;
  description: string;
}

/** 初回取得・更新のどちらの支払い確認にも使う。デモのため実際の決済は行わない */
export const PAYMENT_METHODS: PaymentMethodOption[] = [
  { id: "credit-card", label: "クレジットカード", description: "主要ブランドに対応（デモのため実際の入力欄はありません）" },
  { id: "konbini", label: "コンビニ払い", description: "発行された番号でコンビニのレジからお支払い" },
  { id: "bank-transfer", label: "銀行振込", description: "指定口座への振込確認後に手続きが進みます" },
];
