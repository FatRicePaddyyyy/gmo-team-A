import type { DomainResponse as RegistryDomainResponse } from "../../lib/bridge/types";
import type { domains } from "../../lib/schema/general-schema";

type DomainRow = typeof domains.$inferSelect;

// 一覧・簡易表示用（DBの情報のみ）
export interface DomainResponse {
  id: string;
  name: string;
  registry: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  ownerUserId: string;
  autoRenew: boolean;
}

// 詳細表示用（DB + レジストリの info 情報）
export type DomainDetailResponse = DomainResponse & {
  /**
   * レジストリに問い合わせて最新情報を取れたか。
   *
   * false のとき、statuses / registrant / contacts / nameservers / rgpStatus は
   * 「空」ではなく「取得できていない」。画面はこのフラグを見て、
   * 値ではなく「いま取得できません」と出し、操作も止めること。
   */
  registryAvailable: boolean;
  /**
   * レジストリに問い合わせられなかった理由（日本語）。
   * registryAvailable が true のときは null。
   *
   * メンテナンスなのか通信不良なのかで利用者への案内が変わるので、
   * 「取れなかった」だけでなく理由まで返す。
   */
  registryUnavailableReason: string | null;
  // レジストリの status[] をそのまま保持する。
  // 「復旧できるか」はここに redemptionPeriod が入っているかで判断する。
  // 廃止直後は pendingDelete と redemptionPeriod の両方が付き、45日を過ぎると
  // redemptionPeriod が外れて pendingDelete だけが残る（＝復旧できない）。
  statuses: string[];
  registrant: string;
  contacts: Record<string, string>;
  nameservers: string[];
  // 実機（kitaqsign / kitaqnic）は RGP の情報を status[] 側に入れており、ここは空配列で返る。
  // 復旧可否の判断に使わないこと（statuses を見る）。
  rgpStatus: string[];
  upDate: string | null;
  trDate: string | null;
};

export class DomainMapper {
  static toResponse(row: DomainRow): DomainResponse {
    return {
      id: row.id,
      name: row.name,
      registry: row.registry,
      status: row.status,
      expiresAt: new Date(row.expiresAt).toISOString(),
      createdAt: new Date(row.createdAt).toISOString(),
      ownerUserId: row.ownerUserId,
      autoRenew: row.autoRenew,
    };
  }

  // info 用: DB + レジストリの詳細情報を合成
  // Swagger 上 required だが実装によって欠落しうるフィールド (contacts/nameservers/rgpStatus) は
  // Zod 応答スキーマを 500 で落とさないよう空値でフォールバックする。
  static toDetailResponse(row: DomainRow, registryData: RegistryDomainResponse): DomainDetailResponse {
    return {
      ...DomainMapper.toResponse(row),
      registryAvailable: true,
      registryUnavailableReason: null,
      statuses: registryData.status ?? [],
      registrant: registryData.registrant ?? "",
      contacts: registryData.contacts ?? {},
      nameservers: registryData.nameservers ?? [],
      rgpStatus: registryData.rgpStatus ?? [],
      upDate: registryData.upDate ?? null,
      trDate: registryData.trDate ?? null,
    };
  }

  /**
   * レジストリに問い合わせられなかったときの詳細レスポンス。
   *
   * ドメイン名・有効期限・状態は自社 DB にあるので、レジストリが落ちていても出せる。
   * これを返さないと、メンテナンス中に詳細ページの中身が丸ごと消えてしまう。
   *
   * レジストリ由来の項目（ネームサーバー・登録者・連絡先・RGP）は
   * 「無い」ではなく「取得できていない」なので、空配列と registryAvailable: false の
   * 組み合わせで区別する。画面側はこのフラグを見て、値ではなく状態を出す。
   */
  static toDetailResponseWithoutRegistry(
    row: DomainRow,
    reason: string,
  ): DomainDetailResponse {
    return {
      ...DomainMapper.toResponse(row),
      registryAvailable: false,
      registryUnavailableReason: reason,
      statuses: [],
      registrant: "",
      contacts: {},
      nameservers: [],
      rgpStatus: [],
      upDate: null,
      trDate: null,
    };
  }
}
