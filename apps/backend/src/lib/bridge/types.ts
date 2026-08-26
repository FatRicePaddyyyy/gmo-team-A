// レジストリの型は openapi-typescript で Swagger から自動生成する。
// Kitaqsign / Kitaqnic はコマンド体系がほぼ共通なので、ここでは Kitaqsign を代表として参照する。
// レジストリ間で shape が違うエンドポイントは bridge/index.ts 側で registry ごとに分岐して
// 共通形に normalize する (例: hello — Kitaqnic は resData.info.supportedTlds にネスト)。
// **生成型は bridge 内部の実装詳細**。この module から外向きに出す型は生成型に依存させない。
// 生成: `pnpm openapi:gen`
import type { components } from "./generated/kitaqsign";

type Schemas = components["schemas"];

export type { Registry } from "./client";

// ドメイン系
// Swagger 上 exDate は optional だが、EPP の domain:create / info / renew / update の成功レスポンスでは
// 実運用上必ず返る（bridge 側で欠落を invalid_registry_response として弾く）ため、
// bridge の返り値型では exDate: string に絞る。呼び出し側で `data.exDate` が必ず string になる。
type WithRequiredExDate<T extends { exDate?: string }> = Omit<T, "exDate"> & { exDate: string };

// Swagger 上 required と定義されているが、実際のレジストリ実装によっては欠落しうるフィールドを
// optional に緩める。呼び出し側で `?? []` / `?? {}` などのフォールバックを書ける状態にするための
// narrowing。生成型は仕様上の契約、実装型はランタイム現実。
type WithOptionalRegistryFields<T> = Omit<T, "status" | "registrant" | "contacts" | "nameservers" | "rgpStatus"> & {
  status?: string[];
  registrant?: string;
  contacts?: Record<string, string>;
  nameservers?: string[];
  rgpStatus?: string[];
};

export type DomainCheckResult = Schemas["DomainCheckResult"];
export type DomainCheckResponse = Schemas["DomainCheckResponse"];
export type DomainCreateResponse = WithRequiredExDate<Schemas["DomainCreateResponse"]>;
export type DomainResponse = WithOptionalRegistryFields<WithRequiredExDate<Schemas["DomainResponse"]>>;
export type DomainRenewResponse = WithRequiredExDate<Schemas["DomainRenewResponse"]>;
export type DomainTransferResponse = Schemas["DomainTransferResponse"];

// セッション（hello）
// レジストリごとに hello の resData shape が違う (Kitaqsign は resData.tlds、
// Kitaqnic は resData.info.supportedTlds にネスト) ので、bridge の外向きは
// **生成型に依存しない共通形** を返す。normalize は bridge/index.ts 側で行う。
export interface GreetingResponse {
  registryCode: string;
  tlds: string[];
}

// Poll
// 生成型の payload は `{ [key: string]: Record<string, never> }` と過剰に厳しいため、
// 実際のメッセージが持つ domain/status を安全に読める形に上書きする。
// B9: Swagger 上 id は int64。JS の number は 2^53-1 までしか安全に扱えないため、
// 大きな id が来ても失われないよう bridge 内では number として受け、ack 直前に文字列化して送る。
// 現状 Kitaqsign/Kitaqnic は 2^53 を超える id を発行していないが、防御的に型に msgType 等も明記する。
export type PollMessage = Omit<Schemas["PollMessageDto"], "payload"> & {
  msgType?: string;
  payload: {
    domain?: string;
    status?: string;
    [key: string]: unknown;
  };
};
