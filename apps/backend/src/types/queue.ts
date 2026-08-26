// Cloudflare Queues の transfer-poll に送るメッセージ本体。
// リトライ回数は Cloudflare Queues 側 (message.attempts / max_retries) が管理するので、
// backend 側で attempt を持たない。
export interface TransferPollMessage {
  transferId: string;
}
