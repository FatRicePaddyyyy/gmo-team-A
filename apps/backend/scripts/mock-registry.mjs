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

// 対応 TLD。本物の kitaqsign に合わせている
const TLDS = ["com", "net", "org", "info"];

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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  const clTRID = req.headers["x-cl-trid"] ?? null;
  const log = (msg) => console.log(`  ${method} ${path} → ${msg}`);

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
  const domainMatch = path.match(/^\/api\/v1\/epp\/domains\/([^/]+)(\/[a-z-]+)?$/);
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
