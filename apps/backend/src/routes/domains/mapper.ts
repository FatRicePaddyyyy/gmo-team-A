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
      statuses: registryData.status ?? [],
      registrant: registryData.registrant ?? "",
      contacts: registryData.contacts ?? {},
      nameservers: registryData.nameservers ?? [],
      rgpStatus: registryData.rgpStatus ?? [],
      upDate: registryData.upDate ?? null,
      trDate: registryData.trDate ?? null,
    };
  }
}
