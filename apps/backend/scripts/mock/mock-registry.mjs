#!/usr/bin/env node
//
// mock-registry.mjs — Kitaqsign / Kitaqnic の代わりになる、その場限りのレジストリ。
//
// なぜ要るか:
//   本物のレジストリを叩くには API キーが要る。キーが無い間も
//   「ハンドラ → サービス → bridge → DB」と、result.code から HTTP への変換が
//   正しいかは確かめたい。そこだけを見るために、レジストリ側を差し替える。
//
// 何を保証しないか:
//   これは**私たちのコードの検証**であって、本物のレジストリの挙動の検証ではない。
//   本物と挙動が違えば、このモックを通っても本番で落ちる。
//   キーが手に入ったら必ず本物でもう一度通すこと。
//
// 使い方:
//   1) node scripts/mock-registry.mjs            # :9999 で待ち受ける
//   2) apps/backend/.env に下の2行を足す
//        KITAQSIGN_BASE_URL=http://localhost:9999
//        KITAQNIC_BASE_URL=http://localhost:9999
//   3) pnpm dev で backend を再起動
//   4) ./scripts/restore-domain-e2e.sh
//   終わったら .env の2行を消す（消し忘れると本物を叩かなくなる）
//
// 実装している範囲: restore を通すのに必要なぶんだけ。
//   sessions/hello / contacts / domains(check・create・info・delete・restore・renew)
//
// EPP の共通エンベロープと result.code は本物に合わせている。
//   1000=成功 / 2302=既存 / 2303=不在 / 2304=状態が不正（restore できない）

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.MOCK_PORT ?? 9999);

// 廃止したときに返す status。
// 実機（kitaqsign / kitaqnic）は pendingDelete を返すが、RFC 3915 の RGP では
// redemptionPeriod が「まだ復旧できる猶予期間」にあたる。
// レジストリ側が仕様どおりになったときの挙動を確かめたいときは
//   MOCK_DELETE_STATUS=redemptionPeriod node scripts/mock-registry.mjs
// で切り替える。
const DELETE_STATUS = process.env.MOCK_DELETE_STATUS ?? "pendingDelete";

// 対応 TLD。kitaqsign + kitaqnic を両方受ける (どちらも同じ mock に向ける前提)。
// L (bridge エラー写像) 用スクリプトは .com と .xyz の両方の force ドメインを叩く。
const TLDS = ["com", "net", "org", "info", "xyz", "shop", "store", "app", "dev", "io"];

/** @type {Map<string, {id: string}>} */
const contacts = new Map();
/**
 * @type {Map<string, {
 *   domain: string, registrant: string, contacts: Record<string,string>,
 *   nameservers: string[], status: string[], rgpStatus: string[],
 *   crDate: string, exDate: string, upDate?: string, trDate?: string,
 *   authInfo: string,
 * }>}
 */
const domains = new Map();

const nowIso = () => new Date().toISOString();
const plusYears = (n) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + n);
  return d.toISOString();
};

function envelope(code, message, resData, clTRID) {
  return {
    result: { code, message },
    resData: resData ?? null,
    extension: null,
    trID: { clTRID: clTRID ?? null, svTRID: `MOCK-${randomUUID().slice(0, 8).toUpperCase()}` },
  };
}

const OK = "Command completed successfully";

function send(res, httpStatus, body) {
  const payload = JSON.stringify(body);
  res.writeHead(httpStatus, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}

function tldOf(name) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

// 本物は Basic ゲート + X-Registrar-Id + X-Api-Key を見るが、
// モックは「ヘッダが付いているか」だけ確認する（付け忘れに気づけるように）。
function missingAuth(req) {
  if (!req.headers["authorization"]) {return "Authorization ヘッダがありません";}
  if (!req.headers["x-registrar-id"]) {return "X-Registrar-Id ヘッダがありません";}
  if (!req.headers["x-api-key"]) {return "X-Api-Key ヘッダがありません";}
  return null;
}

// L (bridge エラー写像) 用の force レスポンス。
// クエリまたはドメイン名から (httpStatus, resultCode) を取り出す。
//
// 契約:
//   1) クエリ ?forceHttp=N&forceCode=M があれば最優先
//   2) パスに含まれるドメイン名 (2 セグメント目以降) が
//      "force-h<HTTP>-c<CODE>.<tld>" にマッチすれば適用
//        例: force-h422-c2306.com  → HTTP 422 + result.code 2306
//        例: force-h504-c0.com     → HTTP 504 + envelope 無し (エラー body 想定)
//   3) resultCode=0 のときは envelope を作らず 空 body を返す (プロトコル外のエラー)
//   4) POST /api/v1/epp/domains の body.names / body.domain / body.name も見る
function parseForceFromString(s) {
  if (!s) return null;
  const m = s.match(/force-h(\d{3})-c(\d{1,4})/i);
  if (!m) return null;
  return { http: Number(m[1]), code: Number(m[2]) };
}
function pickForce(url, extra) {
  const qh = Number(url.searchParams.get("forceHttp"));
  const qc = Number(url.searchParams.get("forceCode"));
  if (Number.isFinite(qh) && qh > 0 && Number.isFinite(qc)) {
    return { http: qh, code: qc, msg: url.searchParams.get("forceMsg") ?? undefined };
  }
  // path 中の全セグメントを走査
  for (const seg of url.pathname.split("/")) {
    const hit = parseForceFromString(decodeURIComponent(seg));
    if (hit) return { ...hit, msg: undefined };
  }
  if (extra) {
    const hit = parseForceFromString(extra);
    if (hit) return { ...hit, msg: undefined };
  }
  return null;
}
function sendForce(res, force, clTRID, log) {
  const msg = force.msg ?? `forced http=${force.http} code=${force.code}`;
  log(`FORCE http=${force.http} code=${force.code}`);
  if (force.code === 0) {
    // envelope を作らずゴミ body を返す (invalid_registry_response 誘発)
    res.writeHead(force.http, { "Content-Type": "text/plain" });
    return res.end("forced-non-json");
  }
  send(res, force.http, envelope(force.code, msg, null, clTRID));
}

// --- メンテナンスモード -------------------------------------------------
// 本物のレジストリは定期メンテナンスに入ると、どのエンドポイントでも
// HTTP 503 + EPP 2500 を返す（実測 2026-08-27・kitaqsign / kitaqnic とも同じ）。
// メンテ中の画面を確かめるのに本物のメンテ時間を待つのは再現性が無いので、
// ここで再現できるようにする。
//
//   MAINTENANCE=1 node scripts/mock/mock-registry.mjs
//
// 起動後に切り替えたいときは:
//   curl -X POST localhost:9999/__mock/maintenance -d '{"on":true}'
let maintenance = process.env.MAINTENANCE === "1";
const MAINTENANCE_MSG = "ただいまメンテナンスのため一時的にご利用いただけません。時間をおいて再度お試しください。 / The registry is temporarily unavailable due to maintenance.";

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  const clTRID = req.headers["x-cl-trid"] ?? null;
  const log = (msg) => console.log(`  ${method} ${path} → ${msg}`);

  // --- コンタクトの差し替え（モック専用。移管で入ってきたドメインの再現用）
  // 自分で取得したドメインは 3 ロールとも同じ連絡先になるため、
  // 「3 者が別人」の分岐をこれ無しでは確認できない。
  if (path === "/__mock/contacts" && method === "POST") {
    const body = await readBody(req);
    const record = domains.get(body?.name);
    if (!record) { return send(res, 404, { error: "domain not found" }); }
    record.contacts = body.contacts;
    log(`contacts replaced for ${body.name}`);
    return send(res, 200, { contacts: record.contacts });
  }

  // --- メンテナンスの切り替え（モック専用。本物には無いエンドポイント）
  if (path === "/__mock/maintenance") {
    if (method === "POST") {
      const body = await readBody(req);
      maintenance = Boolean(body?.on);
    }
    log(`maintenance=${maintenance}`);
    return send(res, 200, { maintenance });
  }

  // --- メンテ中は hello も含めて全部 503 + 2500。
  // 本物は msg フィールドで返してくる（message ではない）ので、そこも合わせる。
  if (maintenance) {
    log("503 2500 maintenance");
    return send(res, 503, {
      result: { code: 2500, msg: MAINTENANCE_MSG },
      trID: { clTRID, svTRID: null },
    });
  }

  // --- L 用 force: hello 以外の全ハンドラで最優先。
  // 認証チェックより前に判定し、"認証OKでも指定 code" を再現可能にする。
  // domain:check は body の names[] にも force パターンを埋め込めるよう、
  // 下の check ハンドラ内で追加チェックする。
  if (path !== "/api/v1/epp/sessions/hello") {
    const force = pickForce(url, null);
    if (force) return sendForce(res, force, clTRID, log);
  }

  // --- hello: API キー不要（本物と同じ） ---
  if (method === "GET" && path === "/api/v1/epp/sessions/hello") {
    log("1000 hello");
    return send(res, 200, envelope(1000, OK, {
      registryCode: "MOCK",
      tlds: TLDS,
      message: "Welcome to MOCK EPP-over-REST registry",
    }, clTRID));
  }

  // --- ここから先は認証ヘッダが要る ---
  const authError = missingAuth(req);
  if (authError) {
    log(`2200 ${authError}`);
    return send(res, 401, envelope(2200, "Authentication error", null, clTRID));
  }

  // --- contact:create ---
  if (method === "POST" && path === "/api/v1/epp/contacts") {
    const body = await readBody(req);
    if (!body.id) {
      log("2005 id が無い");
      return send(res, 400, envelope(2005, "Parameter value syntax error", null, clTRID));
    }
    if (contacts.has(body.id)) {
      log(`2302 コンタクト既存 ${body.id}`);
      return send(res, 409, envelope(2302, "Object exists", null, clTRID));
    }
    contacts.set(body.id, { id: body.id });
    log(`1000 コンタクト作成 ${body.id}`);
    return send(res, 201, envelope(1000, OK, { id: body.id }, clTRID));
  }

  // --- domain:check ---
  if (method === "POST" && path === "/api/v1/epp/domains/check") {
    const body = await readBody(req);
    const names = Array.isArray(body.names) ? body.names : [];
    // 名前に force パターンが含まれていれば最優先
    for (const n of names) {
      const force = pickForce(url, n);
      if (force) return sendForce(res, force, clTRID, log);
    }
    const results = names.map((name) => {
      const known = domains.has(name);
      return { name, avail: !known, reason: known ? "in use" : null };
    });
    log(`1000 check ${names.join(",")}`);
    return send(res, 200, envelope(1000, OK, { results }, clTRID));
  }

  // --- domain:create ---
  if (method === "POST" && path === "/api/v1/epp/domains") {
    const body = await readBody(req);
    const name = body.domain;
    if (!name) {
      log("2005 domain が無い");
      return send(res, 400, envelope(2005, "Parameter value syntax error", null, clTRID));
    }
    // 名前に force パターンが含まれていれば最優先
    const forceOnCreate = pickForce(url, name);
    if (forceOnCreate) return sendForce(res, forceOnCreate, clTRID, log);
    if (!TLDS.includes(tldOf(name))) {
      log(`422 非対応TLD ${name}`);
      return send(res, 422, envelope(2306, "Parameter value policy error", null, clTRID));
    }
    if (domains.has(name)) {
      log(`2302 ドメイン既存 ${name}`);
      return send(res, 409, envelope(2302, "Object exists", null, clTRID));
    }
    // 参照先のコンタクトが無ければ 404（本物と同じ）
    if (body.registrant && !contacts.has(body.registrant)) {
      log(`2303 コンタクト不在 ${body.registrant}`);
      return send(res, 404, envelope(2303, "Object does not exist", null, clTRID));
    }
    const years = body.period?.unit?.toUpperCase() === "Y" ? (body.period.value ?? 1) : 1;
    const record = {
      domain: name,
      registrant: body.registrant ?? "",
      contacts: body.contacts ?? {},
      nameservers: body.nameservers ?? [],
      // NS が無ければ inactive。本物の仕様に合わせている
      status: body.nameservers?.length ? ["ok"] : ["inactive"],
      rgpStatus: [],
      crDate: nowIso(),
      exDate: plusYears(years),
      authInfo: body.authInfo ?? "",
    };
    domains.set(name, record);
    log(`1000 ドメイン作成 ${name}`);
    return send(res, 201, envelope(1000, OK, {
      domain: name, crDate: record.crDate, exDate: record.exDate,
    }, clTRID));
  }

  // --- /api/v1/epp/domains/{name}... ---
  // action は 0〜2 セグメント (/restore, /renew, /transfer/request 等)
  const domainMatch = path.match(/^\/api\/v1\/epp\/domains\/([^/]+)((?:\/[a-z-]+){0,2})$/);
  if (domainMatch) {
    const name = decodeURIComponent(domainMatch[1]);
    const action = domainMatch[2] ?? "";
    const record = domains.get(name);

    if (!record) {
      log(`2303 ドメイン不在 ${name}`);
      return send(res, 404, envelope(2303, "Object does not exist", null, clTRID));
    }

    // domain:info
    if (method === "GET" && action === "") {
      log(`1000 info ${name} [${record.status.join(",")}]`);
      return send(res, 200, envelope(1000, OK, {
        domain: record.domain,
        status: record.status,
        registrant: record.registrant,
        contacts: record.contacts,
        nameservers: record.nameservers,
        crDate: record.crDate,
        exDate: record.exDate,
        upDate: record.upDate ?? null,
        trDate: record.trDate ?? null,
        rgpStatus: record.rgpStatus,
      }, clTRID));
    }

    // domain:delete → pendingDelete に落とす
    if (method === "DELETE" && action === "") {
      if (record.status.includes("pendingDelete")) {
        log(`2304 すでに pendingDelete ${name}`);
        return send(res, 200, envelope(2304, "Object status prohibits operation", null, clTRID));
      }
      record.status = [DELETE_STATUS];
      // RGP の猶予期間に入る
      record.rgpStatus = ["redemptionPeriod"];
      record.upDate = nowIso();
      log(`1000 delete ${name} → ${DELETE_STATUS}`);
      return send(res, 200, envelope(1000, OK, {}, clTRID));
    }

    // domain:restore ← 本題
    // 猶予状態の呼び名は redemptionPeriod / pendingDelete の2通りある。どちらからでも復旧できる。
    if (method === "POST" && action === "/restore") {
      const restorable = record.status.some(s => s === "redemptionPeriod" || s === "pendingDelete");
      if (!restorable) {
        log(`2304 pendingDelete でないので復旧不可 ${name} [${record.status.join(",")}]`);
        return send(res, 200, envelope(2304, "Object status prohibits operation", null, clTRID));
      }
      record.status = record.nameservers.length ? ["ok"] : ["inactive"];
      record.rgpStatus = [];
      record.upDate = nowIso();
      log(`1000 restore ${name} → ${record.status.join(",")}`);
      return send(res, 200, envelope(1000, OK, {}, clTRID));
    }

    // domain:renew
    if (method === "POST" && action === "/renew") {
      const body = await readBody(req);
      const years = body.period?.unit?.toUpperCase() === "Y" ? (body.period.value ?? 1) : 1;
      const d = new Date(record.exDate);
      d.setFullYear(d.getFullYear() + years);
      record.exDate = d.toISOString();
      record.upDate = nowIso();
      log(`1000 renew ${name} → ${record.exDate}`);
      return send(res, 200, envelope(1000, OK, { domain: name, exDate: record.exDate }, clTRID));
    }

    // domain:update (add/rem/chg) - L 用の最小実装
    // 実機は 200 + result.code で成否を返す。ここは force で上書きしない限り常に成功。
    if (method === "PUT" && action === "") {
      const body = await readBody(req);
      const add = body.add ?? {};
      const rem = body.rem ?? {};
      const chg = body.chg ?? {};
      if (Array.isArray(add.nameservers)) {
        for (const ns of add.nameservers) {
          if (!record.nameservers.includes(ns)) record.nameservers.push(ns);
        }
      }
      if (Array.isArray(rem.nameservers)) {
        record.nameservers = record.nameservers.filter((n) => !rem.nameservers.includes(n));
      }
      if (Array.isArray(add.statuses)) {
        for (const s of add.statuses) {
          if (!record.status.includes(s)) record.status.push(s);
        }
      }
      if (Array.isArray(rem.statuses)) {
        record.status = record.status.filter((s) => !rem.statuses.includes(s));
      }
      if (chg.registrant) record.registrant = chg.registrant;
      if (chg.authInfo) record.authInfo = chg.authInfo;
      record.upDate = nowIso();
      log(`1000 update ${name}`);
      return send(res, 200, envelope(1000, OK, {
        domain: name, status: record.status,
        registrant: record.registrant, contacts: record.contacts,
        nameservers: record.nameservers, crDate: record.crDate, exDate: record.exDate,
        upDate: record.upDate, trDate: record.trDate ?? null,
        rgpStatus: record.rgpStatus,
      }, clTRID));
    }

    // domain:transfer request (L の 2202 テスト用最小実装)
    // 本物は 202 + code=1001 が成功。force で上書きしない限り成功を返す。
    if (method === "POST" && action === "/transfer/request") {
      const body = await readBody(req);
      if (body.authInfo && record.authInfo && body.authInfo !== record.authInfo) {
        log(`2202 authInfo 不一致 ${name}`);
        return send(res, 202, envelope(2202, "Invalid authorization information", null, clTRID));
      }
      record.status = [...new Set([...record.status, "pendingTransfer"])];
      record.upDate = nowIso();
      log(`1001 transfer request ${name}`);
      return send(res, 202, envelope(1001, "Command completed successfully; action pending", {
        domain: name, status: "pendingTransfer",
        gainingRegistrar: "REG-002", losingRegistrar: "REG-001",
      }, clTRID));
    }
  }

  log("404 モック未実装");
  send(res, 404, envelope(2303, "Object does not exist", null, clTRID));
});

server.listen(PORT, () => {
  console.log(`モックレジストリ起動: http://localhost:${PORT}`);
  console.log(`対応TLD: ${TLDS.join(" ")}`);
  console.log(`廃止時に返す status: ${DELETE_STATUS}（MOCK_DELETE_STATUS で変更可）`);
  console.log(".env に KITAQSIGN_BASE_URL / KITAQNIC_BASE_URL を向けて backend を再起動してください");
  console.log("Ctrl+C で終了。状態はメモリだけなので、止めると全部消えます\n");
});
