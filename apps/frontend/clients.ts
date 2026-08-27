import { hc } from "hono/client";
import type { InferResponseType, InferRequestType } from "hono/client";
import type { ApiType } from "backend";

const client = (baseUrl: string) =>
  hc<ApiType>(baseUrl, {
    init: {
      credentials: "include",
    },
  }).api.v1;

// ドメイン空き確認は認証不要の公開エンドポイント（未ログインの検索導線から呼べる）
export const $checkDomain = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).public.domains.check.$post;
export type CheckDomainRequest = InferRequestType<typeof $checkDomain>;
export type CheckDomainResponse = InferResponseType<typeof $checkDomain>;

export const $listDomains = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.domains.$get;
export type ListDomainsResponse = InferResponseType<typeof $listDomains>;

// マイドメインの「最新にする」で叩く同期エンドポイント。
// 消滅済みのドメインを DB から掃除する副作用があるため、GET とは別に POST で切っている。
export const $refreshMyDomains = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.domains.refresh.$post;
export type RefreshMyDomainsResponse = InferResponseType<typeof $refreshMyDomains>;

export const $createDomain = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.domains.$post;
export type CreateDomainRequest = InferRequestType<typeof $createDomain>;
export type CreateDomainResponse = InferResponseType<typeof $createDomain>;

export const $getDomain = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.domains[":domain-id"].$get;
export type GetDomainRequest = InferRequestType<typeof $getDomain>;
export type GetDomainResponse = InferResponseType<typeof $getDomain>;

export const $updateDomain = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.domains[":domain-id"].$put;
export type UpdateDomainRequest = InferRequestType<typeof $updateDomain>;
export type UpdateDomainResponse = InferResponseType<typeof $updateDomain>;

export const $deleteDomain = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.domains[":domain-id"].$delete;
export type DeleteDomainRequest = InferRequestType<typeof $deleteDomain>;
export type DeleteDomainResponse = InferResponseType<typeof $deleteDomain>;

export const $renewDomain = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.domains[":domain-id"].renew.$post;
export type RenewDomainRequest = InferRequestType<typeof $renewDomain>;
export type RenewDomainResponse = InferResponseType<typeof $renewDomain>;

export const $restoreDomain = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.domains[":domain-id"].restore.$post;
export type RestoreDomainRequest = InferRequestType<typeof $restoreDomain>;
export type RestoreDomainResponse = InferResponseType<typeof $restoreDomain>;

export const $approveTransfer = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.domains[":domain-id"].transfer.approve.$post;
export type ApproveTransferRequest = InferRequestType<typeof $approveTransfer>;
export type ApproveTransferResponse = InferResponseType<typeof $approveTransfer>;

export const $rejectTransfer = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.domains[":domain-id"].transfer.reject.$post;
export type RejectTransferRequest = InferRequestType<typeof $rejectTransfer>;
export type RejectTransferResponse = InferResponseType<typeof $rejectTransfer>;

export const $requestTransfer = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.transfers.$post;
export type RequestTransferRequest = InferRequestType<typeof $requestTransfer>;
export type RequestTransferResponse = InferResponseType<typeof $requestTransfer>;

export const $cancelTransfer = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.transfers[":transfer-id"].cancel.$post;
export type CancelTransferRequest = InferRequestType<typeof $cancelTransfer>;
export type CancelTransferResponse = InferResponseType<typeof $cancelTransfer>;

// 「今すぐ移管 poll を回す」ユーザートリガー。
// backend 側で 10 秒に 1 回にスロットルされているので、多重呼び出しは skip される (200 + ran:false)。
// 詳細ページの「最新にする」やタブ切替時に、cron を待たず反映するために使う。
export const $pollNowTransfer = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.transfers["poll-now"].$post;
export type PollNowTransferResponse = InferResponseType<typeof $pollNowTransfer>;

// 自分が申請した移管の一覧（取消対象を見つけるために使う）
export const $listTransfers = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.transfers.$get;
export type ListTransfersResponse = InferResponseType<typeof $listTransfers>;

// 自分のドメインに来ている移管申請の一覧（承認・却下の対象）
export const $listPendingInboundTransfers = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.domains["pending-inbound-transfers"].$get;
export type ListPendingInboundTransfersResponse = InferResponseType<
  typeof $listPendingInboundTransfers
>;

// 自分のドメインに来た移管申請のうち、渡さずに終わったもの（却下・取消・期限切れ）。
// 決着すると上の一覧から消えるので、記録はこちらで見る。
// 承認済みは含まない（渡したあとは記録が残らないか、別人の履歴になるため）。
export const $listInboundTransferHistory = client(
  process.env.NEXT_PUBLIC_BACKEND_URL!,
).secure.domains["inbound-transfer-history"].$get;
export type ListInboundTransferHistoryResponse = InferResponseType<
  typeof $listInboundTransferHistory
>;
