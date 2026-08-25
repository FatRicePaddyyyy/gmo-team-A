import { domains } from "../../lib/schema/general-schema";
import type { DomainResponse as RegistryDomainResponse } from "../../lib/bridge/types";

type DomainRow = typeof domains.$inferSelect;

// 一覧・簡易表示用（DBの情報のみ）
export type DomainResponse = {
  id: string;
  name: string;
  registry: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  ownerUserId: string;
  autoRenew: boolean;
};

// 詳細表示用（DB + レジストリの info 情報）
export type DomainDetailResponse = DomainResponse & {
  statuses: string[];             // Swagger status[] を全て保持
  registrant: string;
  contacts: Record<string, string>;
  nameservers: string[];
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
  static toDetailResponse(row: DomainRow, registryData: RegistryDomainResponse): DomainDetailResponse {
    return {
      ...DomainMapper.toResponse(row),
      statuses: registryData.status,
      registrant: registryData.registrant,
      contacts: registryData.contacts,
      nameservers: registryData.nameservers,
      rgpStatus: registryData.rgpStatus,
      upDate: registryData.upDate ?? null,
      trDate: registryData.trDate ?? null,
    };
  }
}
