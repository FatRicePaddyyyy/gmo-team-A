import { TransferStatusRepository } from "../../domains/transfer/repository";
import { RegistryBridge } from "../../lib/bridge";
import type { Registry } from "../../lib/bridge/types";
import type { DBClient } from "../../lib/db";
import { toUserMessage } from "../../lib/error-messages";
import { isValidFqdn } from "../../lib/registry-policy";
import type { Result } from "../../types/result";
import { DomainMapper   } from "./mapper";
import type {DomainDetailResponse, DomainResponse} from "./mapper";
import { DomainRepository } from "./repository";
import { DomainTransferRepository } from "./transfer-repository";
import { DomainUserRepository } from "./user-repository";

// 廃止したドメインが取りうる状態。
//
// レジストリの仕様（実機で確認済み）:
//   廃止直後   status = ["pendingDelete", "redemptionPeriod"]  → 復旧できる
//   45日経過後 status = ["pendingDelete"]                      → 復旧できない
// pendingDelete は復旧できなくなったあとも付いたままなので、それだけでは
// 復旧できるかを判断できない。復旧可否は redemptionPeriod の有無で決まる。
//
// なお復旧できるかどうかの判断はレジストリに任せている（DB の値は古い可能性があるため）。
// ここで使うのは「復旧した直後にまだ廃止中の値が返ってきたら ok に倒す」ためだけ。
const DELETED_STATUSES = ["redemptionPeriod", "pendingDelete"] as const;

function isDeletedStatus(status: string): boolean {
  return (DELETED_STATUSES as readonly string[]).includes(status);
}

// レジストリの status[] を DB カラム用の 1 つの status に集約する。
// B7: DB の status は「ドメインが今どの遷移状態にあるか」を表す業務ステータスなので、
// 復旧できる猶予状態 (redemptionPeriod) が最優先、次に pending*、続いて server* の運用ロック、
// それ以外は "ok" に丸める。
// clientTransferProhibited など client 系フラグは DB.status に載せない
// (載せると "ok" 判定が壊れて transfer/renew ができなくなる)。
function pickPrimaryStatus(statuses: string[], fallback: string): string {
  // 廃止直後は pendingDelete と redemptionPeriod が両方付く。復旧できるのは
  // redemptionPeriod があるときだけなので、そちらを優先して記録する
  // （45日経過後は pendingDelete だけが残り、復旧できない状態と区別できる）。
  if (statuses.includes("redemptionPeriod")) {return "redemptionPeriod";}
  if (statuses.includes("pendingDelete")) {return "pendingDelete";}
  if (statuses.includes("pendingTransfer")) {return "pendingTransfer";}
  if (statuses.includes("pendingRenew")) {return "pendingRenew";}
  if (statuses.includes("pendingUpdate")) {return "pendingUpdate";}
  if (statuses.includes("pendingCreate")) {return "pendingCreate";}
  if (statuses.includes("serverHold")) {return "serverHold";}
  if (statuses.includes("inactive")) {return "inactive";}
  if (statuses.includes("ok")) {return "ok";}
  if (statuses.length === 0) {return fallback;}
  // 未知のステータス集合。fallback を返し、client 系フラグに引きずられないようにする。
  return fallback;
}

export interface DomainCheckItem {
  /**
   * 確認できなかった理由（`failed: true` のときだけ入る）。
   *
   * これまで理由を捨てていたため、レジストリのメンテナンス中でも画面には
   * 「一時的な問題」としか出せず、利用者は何度も検索し直すことになっていた。
   * 内部エラーコード（registry_maintenance など）をそのまま載せず、
   * ハンドラで日本語に変換してから返す。
   */
  reason?: string;
  name: string;
  avail: boolean;
  /** 通信障害・レジストリ障害などで確認自体ができなかった */
  failed: boolean;
}

/**
 * レジストリに届かなかった（＝相手側の都合）エラーかどうか。
 *
 * これらは「このドメインが変」なのではなく「いま問い合わせられない」だけなので、
 * 手元にある情報を返す判断ができる。ドメイン不在や権限エラーとは扱いを分ける。
 */
function isRegistryUnreachable(error: string): boolean {
  const code = error.split(":")[0]?.trim();
  return (
    code === "registry_maintenance" ||
    code === "network_error" ||
    code === "invalid_registry_response"
  );
}

/**
 * 登録者の氏名を自社 DB から引く。
 *
 * レジストリの registrant は `C-01054F4E` のような内部 ID で利用者には読めない。
 * コンタクトは登録時に自社のユーザー情報から作っているので、氏名は DB 側にある。
 * DB 由来なのでレジストリがメンテナンス中でも出せる。
 *
 * 引けなくても詳細の表示自体は続けたいので、失敗はログに残して空文字を返す。
 */
async function fetchOwnerName(
  ownerUserId: string,
  db: DBClient,
): Promise<string> {
  const result = await DomainUserRepository.findById({ id: ownerUserId, db });
  if (!result.success) {
    console.error("fetchOwnerName: owner lookup failed:", result.error);
    return "";
  }
  return result.data?.name ?? "";
}

export class DomainService {
  /**
   * 複数ドメインの空き確認をまとめて行う（Issue #45 B-3）。
   *
   * 以前は1件ごとに resolveRegistry（= 両レジストリへの hello 2回）+ check を呼んでいたため、
   * TLD_CATALOG 全件を確認すると通信回数が膨らんでいた。ここでは hello を1回ずつだけ呼び、
   * 名前を registry ごとにグルーピングしてから、registry ごとに1回の check にまとめる。
   */
  // レジストリ由来の失敗は項目ごとの avail/failed で表す。一方、名前の形式が不正なケースは
  // 項目に載せると「すでに使われています」と誤って見えてしまうため、処理全体の失敗として返す
  // （Issue #76。avail/failed の2フラグには「そもそも不正な名前」を表す状態が無い）。
  static async checkBulk({
    names,
    env,
  }: {
    names: string[];
    env: CloudflareBindings;
  }): Promise<Result<DomainCheckItem[]>> {
    // Issue #76: 形式は Zod でも検証しているが、service 層でも先に見る（transfers と同じ二段構え）。
    // handler を経由しない呼び出しが将来入っても、レジストリへ送らずここで止められる。
    if (names.some(name => !isValidFqdn(name.trim().toLowerCase()))) {
      return { success: false, data: null, error: "invalid_domain_name" };
    }

    const [ks, kn] = await Promise.all([
      RegistryBridge.hello({ registry: "kitaqsign", env }),
      RegistryBridge.hello({ registry: "kitaqnic", env }),
    ]);

    // レジストリの tlds は先頭ドット付き（".com"）かドットなし（"com"）か仕様上不明。両方に対応
    const normalize = (t: string) => t.toLowerCase().replace(/^\./, "");
    function tldOf(name: string): string | null {
      const normalized = name.trim().toLowerCase();
      const lastDot = normalized.lastIndexOf(".");
      if (lastDot < 0 || lastDot === normalized.length - 1) {return null;}
      return normalized.slice(lastDot + 1);
    }

    const groups: Record<Registry, string[]> = { kitaqsign: [], kitaqnic: [] };
    const results: DomainCheckItem[] = [];

    for (const name of names) {
      const tld = tldOf(name);
      if (!tld) {
        results.push({ name, avail: false, failed: true });
        continue;
      }
      if (ks.success && ks.data.tlds.some(t => normalize(t) === tld)) {
        groups.kitaqsign.push(name);
      } else if (kn.success && kn.data.tlds.some(t => normalize(t) === tld)) {
        groups.kitaqnic.push(name);
      } else if (!ks.success || !kn.success) {
        // 片方でも hello に失敗している場合は「非対応」と断定できない（疎通エラーの可能性）
        results.push({
          name,
          avail: false,
          failed: true,
          reason: (ks.success ? kn.error : ks.error) ?? undefined,
        });
      } else {
        // 両方 hello 成功 + どちらの対応TLDにも無い → 非対応TLDとして確定（障害ではない）
        results.push({ name, avail: false, failed: false });
      }
    }

    for (const registry of ["kitaqsign", "kitaqnic"] as const) {
      const groupNames = groups[registry];
      if (groupNames.length === 0) {continue;}
      const checkResult = await RegistryBridge.check({ names: groupNames, registry, env });
      if (!checkResult.success) {
        for (const name of groupNames) {
          results.push({ name, avail: false, failed: true, reason: checkResult.error });
        }
        continue;
      }
      for (const name of groupNames) {
        const found = checkResult.data.results.find(r => r.name === name);
        results.push({ name, avail: found?.avail ?? false, failed: !found });
      }
    }

    return { success: true, data: results, error: null };
  }

  static async create({
    name,
    registry,
    period,
    nameServers,
    userId,
    db,
    env,
  }: {
    name: string;
    registry: Registry;
    period: { unit: string; value: number };
    nameServers?: string[];
    userId: string;
    db: DBClient;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse>> {
    // Issue #76: FQDN 形式は Zod でも検証しているが、service 層でも念のためチェックする
    // (transfers と同じ二段構え)。handler を経由しない呼び出しが将来入っても弾けるようにする。
    if (!isValidFqdn(name.trim().toLowerCase())) {
      return { success: false, data: null, error: "invalid_domain_name" };
    }

    // 1. 疎通確認: レジストリの hello を叩き、認証ヘッダ・応答・TLD 対応を確認する。
    const helloResult = await RegistryBridge.hello({ registry, env });
    if (!helloResult.success) {return helloResult;}
    const lastDot = name.trim().toLowerCase().lastIndexOf(".");
    const tld = lastDot >= 0 ? name.trim().toLowerCase().slice(lastDot + 1) : "";
    const normalize = (t: string) => t.toLowerCase().replace(/^\./, "");
    const tldSupported = helloResult.data.tlds.some(t => normalize(t) === tld);
    if (!tldSupported) {
      return { success: false, data: null, error: "unsupported_tld" };
    }

    // 2. コンタクト作成: 実ユーザーの name / email を postalInfo.name / email に流し込む。
    //    レジストリの Swagger 制約に沿って、ユーザーは事前に許可ダミー氏名 (例: "Taro Test") と
    //    @example.(com|net|org) のメールで登録されている前提。
    const userResult = await DomainUserRepository.findById({ id: userId, db });
    if (!userResult.success) {return userResult;}
    if (!userResult.data) {
      return { success: false, data: null, error: "user_not_found" };
    }
    const contactResult = await RegistryBridge.createContact({
      name: userResult.data.name,
      email: userResult.data.email,
      registry,
      env,
    });
    if (!contactResult.success) {return contactResult;}
    const contactId = contactResult.data.contactId;

    const authInfo = crypto.randomUUID();

    // 3. ドメイン登録: registrant と contacts.ADMIN/TECH/BILLING に上で作った contactId を割り当てる。
    const createResult = await RegistryBridge.create({
      domain: name,
      period,
      registrant: contactId,
      contacts: { ADMIN: contactId, TECH: contactId, BILLING: contactId },
      authInfo,
      nameservers: nameServers,
      registry,
      env,
    });
    if (!createResult.success) {return createResult;}

    const expiresAt = new Date(createResult.data.exDate);
    const createdAt = new Date(createResult.data.crDate); // レジストリ登録日時
    const dbResult = await DomainRepository.create({
      data: {
        name,
        registry,
        status: "ok",
        expiresAt,
        createdAt,
        authInfo,
        ownerUserId: userId,
      },
      db,
    });
    if (!dbResult.success) {return dbResult;}

    return { success: true, data: DomainMapper.toResponse(dbResult.data), error: null };
  }

  static async list({
    userId,
    db,
  }: {
    userId: string;
    db: DBClient;
  }): Promise<Result<DomainResponse[]>> {
    const result = await DomainRepository.listByUserId({ userId, db });
    if (!result.success) {return result;}
    return { success: true, data: result.data.map(row => DomainMapper.toResponse(row)), error: null };
  }

  /**
   * 自分のドメインをまとめてレジストリと突き合わせ、消滅しているものを DB から掃除する。
   *
   * ユーザー操作 (マイドメインの「最新にする」ボタン) から明示的に叩かれることを想定した
   * 副作用ありの同期処理。 GET /domains は DB のみの読み取りに保つため、この処理は
   * 別の POST エンドポイントに切り出す。
   *
   * 対象: 呼び出し元 userId が owner のドメイン全件。
   * 判定:
   *  - RegistryBridge.info が domain_not_found (2303) を返せば「消滅した」→ deleteById
   *  - RegistryBridge.info が not_sponsored (403) を返せば「別レジストラに移った」→ deleteById
   *    (移管 cron の poll メッセージ取りこぼしで DB に行が残るケースを掃除する。
   *     本番で ruru.com がこの状態になっていた: レジストリは 403 を返すが DB には行があり、
   *     利用者から見ると「復旧」ボタンが押せるのに 403 で失敗する、という状態だった。)
   *  - 通信断・メンテ (registry_unreachable 系) は残す (一時障害で一覧が空になる方が困る)
   *  - pendingTransfer は transfer-cron-poll に委ね、ここでは触らない (FK 制約でも失敗する)
   *  - status 遷移や有効期限のずれはここでは同期しない — 詳細ページの info が担当する
   */
  static async refreshMyDomains({
    userId,
    db,
    env,
  }: {
    userId: string;
    db: DBClient;
    env: CloudflareBindings;
  }): Promise<Result<{ deleted: string[] }>> {
    const listResult = await DomainRepository.listByUserId({ userId, db });
    if (!listResult.success) {return listResult;}

    const deleted: string[] = [];
    await Promise.all(
      listResult.data.map(async (row) => {
        if (row.status === "pendingTransfer") {return;}

        const infoResult = await RegistryBridge.info({
          name: row.name,
          registry: row.registry,
          env,
        });
        if (infoResult.success) {return;}
        if (isRegistryUnreachable(infoResult.error)) {return;}
        // domain_not_found = レジストリ側で消滅、not_sponsored = 別レジストラが預かっている。
        // どちらも「もう当社の管轄ではない」ので DB から掃除する。
        if (infoResult.error !== "domain_not_found" && infoResult.error !== "not_sponsored") {
          console.warn(
            `DomainService.refreshMyDomains: info failed for ${row.name}: ${infoResult.error}`,
          );
          return;
        }

        // レジストリで完全に消滅している or 別レジストラの管轄 → DB から掃除。
        // pending 移管が残っていた場合の FK 失敗はログして残す (次の cron / 操作で解決)。
        const delResult = await DomainRepository.deleteById({ id: row.id, db });
        if (!delResult.success) {
          console.warn(
            `DomainService.refreshMyDomains: could not delete stale ${row.name} (likely FK):`,
            delResult.error,
          );
          return;
        }
        deleted.push(row.name);
      }),
    );

    return { success: true, data: { deleted }, error: null };
  }

  static async info({
    domainId,
    userId,
    db,
    env,
  }: {
    domainId: string;
    userId: string;
    db: DBClient;
    env: CloudflareBindings;
  }): Promise<Result<DomainDetailResponse>> {
    const domainResult = await DomainRepository.findById({ id: domainId, db });
    if (!domainResult.success) {return domainResult;}
    if (domainResult.data?.ownerUserId !== userId) {
      return { success: false, data: null, error: "not_found" };
    }
    const domain = domainResult.data;

    const ownerName = await fetchOwnerName(domain.ownerUserId, db);

    const infoResult = await RegistryBridge.info({ name: domain.name, registry: domain.registry, env });
    if (!infoResult.success) {
      // レジストリが落ちていても、ドメイン名・有効期限・状態は自社 DB にある。
      // ここで打ち切ると詳細ページの中身が丸ごと消えるので、DB の分だけ返す。
      // 「取得できなかった」ことは registryAvailable: false で伝える。
      //
      // ただし通信できないこと自体が異常なケース（認証切れ・不正なドメイン）は
      // そのまま失敗として返す。メンテナンス・疎通不良だけを対象にする。
      if (isRegistryUnreachable(infoResult.error)) {
        console.warn(`DomainService.info: registry unreachable (${infoResult.error}); returning DB-only detail for ${domain.name}`);
        return {
          success: true,
          data: DomainMapper.toDetailResponseWithoutRegistry(
            domain,
            toUserMessage(infoResult.error),
            ownerName,
          ),
          error: null,
        };
      }
      // not_sponsored / domain_not_found = 当社の管轄外だった。DB のゴミ行を掃除して
      // 次回以降マイドメインにも詳細にも出さないようにする (issue #156)。
      // 掃除後は 404 相当として上位に返す (呼び出し側は domain_not_found を 404 に落とす)。
      if (infoResult.error === "not_sponsored" || infoResult.error === "domain_not_found") {
        const del = await DomainRepository.deleteById({ id: domainId, db });
        if (!del.success) {
          console.warn(
            `DomainService.info: ${infoResult.error} の domain ${domain.name} を掃除できませんでした (FK の可能性): ${del.error}`,
          );
        }
        return { success: false, data: null, error: "domain_not_found" };
      }
      return infoResult;
    }

    // exDate は Swagger 上 ISO8601 文字列だが、レジストリ実装によっては非 ISO を返しうる。
    // Invalid Date のまま DB に流すと NaN epoch で保存されるので明示的に検証する。
    const expiresAt = new Date(infoResult.data.exDate);
    if (Number.isNaN(expiresAt.getTime())) {
      return { success: false, data: null, error: "invalid_expires_at" };
    }
    const status = pickPrimaryStatus(infoResult.data.status ?? [], domain.status);

    // 読み取りついでにレジストリの最新値で DB を同期する (best-effort)。
    // ここで DB 書き込みが失敗しても、呼び出し元にはレジストリの新鮮なデータを返したいので、
    // 失敗はログに残して処理は続行する (CQS 的にも read リクエストが write 失敗で 500 にならない)。
    const updateResult = await DomainRepository.updateExpiresAtAndStatus({ id: domainId, expiresAt, status, db });
    if (!updateResult.success) {
      console.error("DomainService.info: DB sync failed but continuing with registry data:", updateResult.error);
    }

    const updatedRow = { ...domain, expiresAt, status };
    return { success: true, data: DomainMapper.toDetailResponse(updatedRow, infoResult.data, ownerName), error: null };
  }

  static async renew({
    domainId,
    period,
    userId,
    db,
    env,
  }: {
    domainId: string;
    period: { unit: string; value: number };
    userId: string;
    db: DBClient;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse>> {
    const domainResult = await DomainRepository.findById({ id: domainId, db });
    if (!domainResult.success) {return domainResult;}
    if (domainResult.data?.ownerUserId !== userId) {
      return { success: false, data: null, error: "not_found" };
    }
    const domain = domainResult.data;

    if (domain.status === "pendingTransfer") {
      return { success: false, data: null, error: "domain_pending_transfer" };
    }

    const curExpDate = new Date(domain.expiresAt).toISOString().split("T")[0];
    if (!curExpDate) {return { success: false, data: null, error: "invalid_expires_at" };}

    const renewResult = await RegistryBridge.renew({
      name: domain.name,
      curExpDate,
      period,
      registry: domain.registry,
      env,
    });
    if (!renewResult.success) {return renewResult;}

    const expiresAt = new Date(renewResult.data.exDate);
    const updateResult = await DomainRepository.updateExpiresAt({ id: domainId, expiresAt, db });
    if (!updateResult.success) {return updateResult;}

    const updated = { ...domain, expiresAt };
    return { success: true, data: DomainMapper.toResponse(updated), error: null };
  }

  static async update({
    domainId,
    nameServers,
    addStatuses,
    remStatuses,
    chg,
    autoRenew,
    userId,
    db,
    env,
  }: {
    domainId: string;
    nameServers?: string[];
    addStatuses?: string[];
    remStatuses?: string[];
    chg?: { registrant?: string; authInfo?: string };
    autoRenew?: boolean; // Issue #24: 自動更新設定
    userId: string;
    db: DBClient;
    env: CloudflareBindings;
  }): Promise<Result<DomainDetailResponse>> {
    const domainResult = await DomainRepository.findById({ id: domainId, db });
    if (!domainResult.success) {return domainResult;}
    if (domainResult.data?.ownerUserId !== userId) {
      return { success: false, data: null, error: "not_found" };
    }
    const domain = domainResult.data;

    if (domain.status === "pendingTransfer") {
      return { success: false, data: null, error: "domain_pending_transfer" };
    }

    // autoRenew のみ変更する場合は、Bridge を呼ばず DB だけ更新して early return
    const hasRegistryChanges = Boolean(nameServers ?? addStatuses ?? remStatuses ?? chg);
    if (!hasRegistryChanges && autoRenew !== undefined) {
      const arResult = await DomainRepository.updateAutoRenew({ id: domainId, autoRenew, db });
      if (!arResult.success) {return arResult;}
      const updatedRow = { ...domain, autoRenew };
      // レジストリからの最新情報はないので info を呼ぶ
      const infoResult = await RegistryBridge.info({ name: domain.name, registry: domain.registry, env });
      if (!infoResult.success) {return infoResult;}
      return {
        success: true,
        data: DomainMapper.toDetailResponse(
          updatedRow,
          infoResult.data,
          await fetchOwnerName(domain.ownerUserId, db),
        ),
        error: null,
      };
    }

    // nameServers の差分展開:
    //   会員 API は「宣言的」に nameServers 全リストを受け取るが、レジストリ (EPP) の update は
    //   add=追加 / rem=削除 の差分プロトコル (Swagger DomainChangeSet)。
    //   宣言 → 差分の変換をここで行わないと、既存 NS を含めて再送した瞬間に "Object exists" で
    //   失敗する (再現: nameservers-e2e-kitaqsign m2〜m5)。
    //   仕様上の根拠: issue #10 / #9「PUT /domains/{id} で NS 変更のみなら nameServers だけでよい。
    //   BRIDGE で add/rem/chg に変換」。
    let nsToAdd: string[] | undefined;
    let nsToRem: string[] | undefined;
    if (nameServers !== undefined) {
      const currentInfo = await RegistryBridge.info({ name: domain.name, registry: domain.registry, env });
      if (!currentInfo.success) {return currentInfo;}
      // 大文字小文字の揺れをレジストリの表記に合わせて (case-insensitive で) 比較する。
      // DNS ホスト名は RFC 1035 上 case-insensitive、実 API は返却時の大文字小文字を保つため、
      // 「大文字だけ違う NS を差分と誤検知して add/rem を打つ」のを防ぐ。
      const current = new Set((currentInfo.data.nameservers ?? []).map((s) => s.toLowerCase()));
      const target = nameServers.map((s) => s.toLowerCase());
      const targetSet = new Set(target);
      const addList = nameServers.filter((s) => !current.has(s.toLowerCase()));
      const remList = (currentInfo.data.nameservers ?? []).filter((s) => !targetSet.has(s.toLowerCase()));
      nsToAdd = addList.length > 0 ? addList : undefined;
      nsToRem = remList.length > 0 ? remList : undefined;
    }

    const add = (nsToAdd || addStatuses)
      ? {
          ...(nsToAdd ? { nameservers: nsToAdd } : {}),
          ...(addStatuses ? { statuses: addStatuses } : {}),
        }
      : undefined;

    const rem = (nsToRem || remStatuses)
      ? {
          ...(nsToRem ? { nameservers: nsToRem } : {}),
          ...(remStatuses ? { statuses: remStatuses } : {}),
        }
      : undefined;

    // すべての差分がゼロで chg/autoRenew も無い場合は、レジストリを叩かず no-op で成功を返す。
    // nameServers 再送 (no-op) を「何もしない」で吸収するのが目的。
    const hasRegistryPayload = Boolean(add ?? rem ?? chg);
    if (!hasRegistryPayload) {
      const infoOnly = await RegistryBridge.info({ name: domain.name, registry: domain.registry, env });
      if (!infoOnly.success) {return infoOnly;}
      // autoRenew だけ来ていれば DB 更新して返す
      if (autoRenew !== undefined) {
        const arResult = await DomainRepository.updateAutoRenew({ id: domainId, autoRenew, db });
        if (!arResult.success) {return arResult;}
      }
      const updatedRow = {
        ...domain,
        ...(autoRenew !== undefined ? { autoRenew } : {}),
      };
      return {
        success: true,
        data: DomainMapper.toDetailResponse(
          updatedRow,
          infoOnly.data,
          await fetchOwnerName(domain.ownerUserId, db),
        ),
        error: null,
      };
    }

    // add.nameservers に指定するホストは事前にレジストリに登録されている必要がある
    // (未登録だと 404+2303 で弾かれる)。会員 API は宣言的に nameServers を受け取るので、
    // add に含まれる新規ホストをここで先回り登録する。既存 (409) は idempotent 化して吸収。
    if (nsToAdd && nsToAdd.length > 0) {
      const hostCreateResults = await Promise.all(
        nsToAdd.map((host) =>
          RegistryBridge.createHost({ name: host, registry: domain.registry, env }),
        ),
      );
      const firstFailure = hostCreateResults.find((r) => !r.success);
      if (firstFailure) {return { success: false, data: null, error: firstFailure.error };}
    }

    const updateResult = await RegistryBridge.update({
      name: domain.name,
      add,
      rem,
      chg,
      registry: domain.registry,
      env,
    });
    if (!updateResult.success) {return updateResult;}

    // update のレスポンス形はレジストリによって異なる（Kitaqnic は空）ため、
    // 最新の DomainResponse は改めて info で取得して DB に同期する
    const infoResult = await RegistryBridge.info({ name: domain.name, registry: domain.registry, env });
    if (!infoResult.success) {return infoResult;}
    const registryData = infoResult.data;
    const expiresAt = new Date(registryData.exDate);
    if (Number.isNaN(expiresAt.getTime())) {
      return { success: false, data: null, error: "invalid_expires_at" };
    }
    const status = pickPrimaryStatus(registryData.status ?? [], domain.status);
    const syncResult = await DomainRepository.updateExpiresAtAndStatus({ id: domainId, expiresAt, status, db });
    if (!syncResult.success) {return syncResult;}

    if (chg?.authInfo) {
      const authInfoResult = await DomainRepository.updateAuthInfo({ id: domainId, authInfo: chg.authInfo, db });
      if (!authInfoResult.success) {return authInfoResult;}
    }

    if (autoRenew !== undefined) {
      const arResult = await DomainRepository.updateAutoRenew({ id: domainId, autoRenew, db });
      if (!arResult.success) {return arResult;}
    }

    const updatedRow = {
      ...domain,
      expiresAt,
      status,
      ...(chg?.authInfo ? { authInfo: chg.authInfo } : {}),
      ...(autoRenew !== undefined ? { autoRenew } : {}),
    };
    return {
      success: true,
      data: DomainMapper.toDetailResponse(
        updatedRow,
        registryData,
        await fetchOwnerName(domain.ownerUserId, db),
      ),
      error: null,
    };
  }

  static async delete({
    domainId,
    userId,
    db,
    env,
  }: {
    domainId: string;
    userId: string;
    db: DBClient;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse>> {
    const domainResult = await DomainRepository.findById({ id: domainId, db });
    if (!domainResult.success) {return domainResult;}
    if (domainResult.data?.ownerUserId !== userId) {
      return { success: false, data: null, error: "not_found" };
    }
    const domain = domainResult.data;

    if (domain.status === "pendingTransfer") {
      return { success: false, data: null, error: "domain_pending_transfer" };
    }

    const deleteResult = await RegistryBridge.delete({
      name: domain.name,
      registry: domain.registry,
      env,
    });
    if (!deleteResult.success) {
      // not_sponsored = 当社が預かっていないドメインだった。自社 DB の行を掃除する
      // (restore と同じ理由。issue #156)。
      if (deleteResult.error === "not_sponsored") {
        const del = await DomainRepository.deleteById({ id: domainId, db });
        if (!del.success) {
          console.warn(
            `DomainService.delete: not_sponsored の domain ${domain.name} を掃除できませんでした (FK の可能性): ${del.error}`,
          );
        }
      }
      return deleteResult;
    }

    // 廃止後の status を "pendingDelete" 決め打ちにしない。
    // delete のレスポンスは resData が空で status を返さないため info で取り直す。
    // 猶予状態の呼び名はレジストリによって redemptionPeriod / pendingDelete と分かれ、
    // 意味も違う（前者は復旧できる、後者は削除待ち）ので、返ってきた値をそのまま記録する。
    // info が取れなければ、実機の挙動に合わせて pendingDelete に倒す。
    const infoResult = await RegistryBridge.info({
      name: domain.name,
      registry: domain.registry,
      env,
    });
    if (!infoResult.success) {
      console.error(
        `DomainService.delete: 廃止後の info を取得できなかったため status を "pendingDelete" として保存します: ${infoResult.error}`,
      );
    }
    // 直前に自分で削除を投げているので、info が ["ok"] を返しても「レジストリの反映待ち」
    // と解釈する (issue #134)。 そのまま採用すると DB を ok で上書きしてしまい、画面上
    // 「使えます」に見えてしまう (実際にはレジストリで削除は成立している)。
    // pickPrimaryStatus は redemptionPeriod / pendingDelete / server 系などを優先するので、
    // それらが 1 つでも含まれていれば正しく拾える。 それらが無く ok だけの場合だけ
    // pendingDelete に倒す。
    const rawStatuses = infoResult.success ? infoResult.data.status ?? [] : [];
    const isReflectingOnly = rawStatuses.length === 1 && rawStatuses[0] === "ok";
    const status = infoResult.success && !isReflectingOnly
      ? pickPrimaryStatus(rawStatuses, "pendingDelete")
      : "pendingDelete";

    const updateResult = await DomainRepository.updateStatus({ id: domainId, status, db });
    if (!updateResult.success) {return updateResult;}

    const updated = { ...domain, status };
    return { success: true, data: DomainMapper.toResponse(updated), error: null };
  }

  // losing (現オーナー) 目線で pending な inbound transfer の一覧を返す。
  // frontend はこの一覧を使って「あなたのドメイン xxx.com に移管申請が来ています」と表示し、
  // approve / reject を叩けるようにする。
  static async listInboundPendingTransfers({
    userId,
    db,
  }: {
    userId: string;
    db: DBClient;
  }): Promise<Result<{
    transferId: string;
    domainId: string;
    domainName: string;
    registry: "kitaqsign" | "kitaqnic";
    requestedAt: string;
  }[]>> {
    const result = await DomainTransferRepository.findInboundPendingByOwner({ ownerUserId: userId, db });
    if (!result.success) {return result;}
    return {
      success: true,
      data: result.data.map(row => ({
        transferId: row.transferId,
        domainId: row.domainId,
        domainName: row.domainName,
        registry: row.registry,
        requestedAt: new Date(row.requestedAt).toISOString(),
      })),
      error: null,
    };
  }

  // 自分のドメインに来た移管申請のうち、渡さずに終わったもの。
  // 決着すると pending 一覧から消えるため、これが無いと
  // 「誰かが取りに来た」記録がどこにも残らない。
  static async listInboundTransferHistory({
    userId,
    db,
  }: {
    userId: string;
    db: DBClient;
  }): Promise<Result<{
    transferId: string;
    domainId: string;
    domainName: string;
    registry: "kitaqsign" | "kitaqnic";
    requestedAt: string;
    status: string;
  }[]>> {
    const result = await DomainTransferRepository.findInboundHistoryByOwner({ ownerUserId: userId, db });
    if (!result.success) {return result;}
    return {
      success: true,
      data: result.data.map(row => ({
        transferId: row.transferId,
        domainId: row.domainId,
        domainName: row.domainName,
        registry: row.registry,
        requestedAt: new Date(row.requestedAt).toISOString(),
        status: row.status,
      })),
      error: null,
    };
  }

  static async approveTransfer({
    domainId,
    userId,
    db,
    env,
  }: {
    domainId: string;
    userId: string;
    db: DBClient;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    const domainResult = await DomainRepository.findById({ id: domainId, db });
    if (!domainResult.success) {return domainResult;}
    if (!domainResult.data) {
      return { success: false, data: null, error: "domain_not_found" };
    }
    const domain = domainResult.data;

    if (domain.ownerUserId !== userId) {
      return { success: false, data: null, error: "forbidden" };
    }

    // B2: pendingTransfer な transfer レコードが存在するかチェック。
    // 既に処理済み (clientApproved/serverApproved/clientRejected/clientCancelled) なら弾く。
    // poll consumer が先に owner 変更を反映していると、ここで元 owner がヒットしても
    // 「pending が無い = 既に処理済み」と判断できる。
    const transferResult = await DomainTransferRepository.findPendingByDomainId({ domainId, db });
    if (!transferResult.success) {return transferResult;}
    if (!transferResult.data) {
      return { success: false, data: null, error: "transfer_not_found" };
    }

    const bridgeResult = await RegistryBridge.transferApprove({
      name: domain.name,
      registry: domain.registry,
      env,
    });
    if (!bridgeResult.success) {return bridgeResult;}

    // bridge 成功後に DB へ確定を反映する。gaining が誰かで分岐:
    //   (a) gainingUserId が入っている = 自 backend 発 pending → owner を書き換え + domain.status=ok
    //   (b) gainingUserId が null = 外部レジストラ発 pending → 別レジストラに所有権が移った
    //       ので自 backend の domains 行を削除する
    if (transferResult.data.gainingUserId === null) {
      const commit = await TransferStatusRepository.commitApprovedAndDropDomain({
        transferId: transferResult.data.id,
        domainId,
        transferStatus: "clientApproved",
        db,
      });
      if (!commit.success) {return commit;}
    } else {
      const commit = await TransferStatusRepository.commitApproved({
        transferId: transferResult.data.id,
        domainId,
        transferStatus: "clientApproved",
        newOwnerUserId: transferResult.data.gainingUserId,
        db,
      });
      if (!commit.success) {return commit;}
    }

    return { success: true, data: undefined, error: null };
  }

  static async rejectTransfer({
    domainId,
    userId,
    db,
    env,
  }: {
    domainId: string;
    userId: string;
    db: DBClient;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    const domainResult = await DomainRepository.findById({ id: domainId, db });
    if (!domainResult.success) {return domainResult;}
    if (!domainResult.data) {
      return { success: false, data: null, error: "domain_not_found" };
    }
    const domain = domainResult.data;

    if (domain.ownerUserId !== userId) {
      return { success: false, data: null, error: "forbidden" };
    }

    // B2: pendingTransfer な transfer が無ければ既に処理済みとして弾く。
    // これを bridge の前に置くことで、確定済みの transfer に対して余分な reject リクエストを送らない。
    const transferResult = await DomainTransferRepository.findPendingByDomainId({ domainId, db });
    if (!transferResult.success) {return transferResult;}
    if (!transferResult.data) {
      return { success: false, data: null, error: "transfer_not_found" };
    }

    const bridgeResult = await RegistryBridge.transferReject({
      name: domain.name,
      registry: domain.registry,
      env,
    });
    if (!bridgeResult.success) {return bridgeResult;}

    // R2: transfer.status と domain.status の 2 更新を batch でアトミック化。
    const settle = await TransferStatusRepository.settleAndReleaseDomain({
      transferId: transferResult.data.id,
      domainId,
      transferStatus: "clientRejected",
      db,
    });
    if (!settle.success) {return settle;}

    return { success: true, data: undefined, error: null };
  }

  static async restore({
    domainId,
    userId,
    db,
    env,
  }: {
    domainId: string;
    userId: string;
    db: DBClient;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse>> {
    const domainResult = await DomainRepository.findById({ id: domainId, db });
    if (!domainResult.success) {return domainResult;}
    if (domainResult.data?.ownerUserId !== userId) {
      return { success: false, data: null, error: "not_found" };
    }
    const domain = domainResult.data;

    const restoreResult = await RegistryBridge.restore({
      name: domain.name,
      registry: domain.registry,
      env,
    });
    if (!restoreResult.success) {
      // not_sponsored = レジストリ側で「そのドメインは当社の管轄ではない」と返ってきた。
      // 自社 DB の行がゴミとして残っている状態なので、その場で掃除してもう表示しないようにする。
      // 本番の ruru.com がこの状態だった (issue #156): 移管 cron のメッセージ取りこぼしで
      // domains 行だけ残り、利用者は復旧ボタンを押しても 403 で失敗し続けていた。
      if (restoreResult.error === "not_sponsored") {
        const del = await DomainRepository.deleteById({ id: domainId, db });
        if (!del.success) {
          console.warn(
            `DomainService.restore: not_sponsored の domain ${domain.name} を掃除できませんでした (FK の可能性): ${del.error}`,
          );
        }
      }
      return restoreResult;
    }

    // 復旧後の status を "ok" 決め打ちにしない。
    // restore のレスポンスは resData が空で status を返さないため、info で取り直す。
    // 決め打ちだと、レジストリが "ok" 以外（inactive / serverHold 等）を返したときに
    // DB とレジストリがズレたままになる（次に info を叩くまで直らない）。
    // info と同じくレジストリの返り値から決め、取れなければ "ok" に倒す。
    // 実測(kitaqsign): NS 未設定のドメインでも復旧後は ["ok"] / rgpStatus ["addPeriod"] だった。
    const infoResult = await RegistryBridge.info({
      name: domain.name,
      registry: domain.registry,
      env,
    });
    if (!infoResult.success) {
      // 復旧そのものは成功しているので処理は続ける。ただし status を確認できていないことは残す。
      console.error(
        `DomainService.restore: 復旧後の info を取得できなかったため status を "ok" として保存します: ${infoResult.error}`,
      );
    }
    const raw = infoResult.success
      ? pickPrimaryStatus(infoResult.data.status ?? [], "ok")
      : "ok";
    // レジストリ側の反映が一瞬遅れて、まだ廃止中（redemptionPeriod / pendingDelete）が
    // 返ることがある。ここで書き戻すと「復旧したのに廃止中」になってしまうので ok に倒す。
    // 「復旧できるか」の判定（isRestorable）とは別物なので、ここでは両方を見る。
    const status = isDeletedStatus(raw) ? "ok" : raw;

    const updateResult = await DomainRepository.updateStatus({ id: domainId, status, db });
    if (!updateResult.success) {return updateResult;}

    const updated = { ...domain, status };
    return { success: true, data: DomainMapper.toResponse(updated), error: null };
  }
}
