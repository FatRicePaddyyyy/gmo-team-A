import { CalendarClock, ShieldAlert, User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/shared/lib/format-date";
import { StatusBadge } from "../../_parts/status-badge";
import {
  redemptionDaysLeft,
  rgpStatusLabelOf,
} from "../../_lib/domain-status";
import type { DomainDetail } from "../_hooks/use-domain-detail.hook";

/**
 * ラベルと値を並べる行。値が空なら「—」を出して、欠落と空文字を区別しない。
 *
 * 「値」は素の string / null / React 要素のいずれもありうる。素の string / null は
 * truthy 判定で拾えるが、`<span>` に包んだ場合は truthy 扱いになるので、
 * 呼び出し側で「中身が空なら null を渡す」ことを徹底する。
 * ここでは最終フォールバックだけ担当する。
 */
function Row({
  label,
  value,
  unavailable = false,
}: {
  label: string;
  value: React.ReactNode;
  /**
   * レジストリに問い合わせられていない項目。
   * 「—」だと「設定されていない」と読めてしまうので、取得できていないことを明示する。
   */
  unavailable?: boolean;
}) {
  // 空文字列も「値なし」扱いにする。backend のレスポンスが一時的に "" を返しても
  // 空表示にならず、必ず「—」が出るようにする（issue #66）
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-gray-100 py-2 last:border-b-0">
      <dt className="w-40 shrink-0 text-xs text-gray-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-gray-900">
        {unavailable ? (
          <span className="text-gray-500">いま取得できません</span>
        ) : empty ? (
          "—"
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

interface DomainOverviewProps {
  domain: DomainDetail;
}

/** ドメインの現在の状態。ここは表示だけで、変更は下のカードが受け持つ */
export function DomainOverview({ domain }: DomainOverviewProps) {
  // レジストリに問い合わせられなかったとき、レジストリ由来の項目は
  // 「無い」ではなく「取れていない」。空欄で見せると誤解を生む。
  const registryDown = !domain.registryAvailable;
  const daysLeft = redemptionDaysLeft({
    status: domain.status,
    rgpStatus: domain.rgpStatus,
    upDate: domain.upDate,
  });

  const contacts = Object.entries(domain.contacts ?? {});

  return (
    <div className="space-y-4">
      {/* 復旧期限は他の情報に埋もれさせず、最初に出す */}
      {daysLeft !== null && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <ShieldAlert
            className="mt-0.5 size-4 shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-semibold text-amber-900">
              {daysLeft > 0
                ? `あと ${daysLeft} 日で復旧できなくなります`
                : "まもなく復旧できなくなります"}
            </p>
            <p className="mt-1 text-xs text-amber-800">
              このドメインは廃止済みです。猶予期間を過ぎると他の人が取得できるようになり、元に戻せません。使い続けるなら、このページの一番下から復旧してください。
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-lg font-bold text-gray-900">
              現在の状態
            </h2>
            <StatusBadge status={domain.status} />
          </div>

          <dl>
            <Row
              label="有効期限"
              value={
                domain.expiresAt ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock
                      className="size-4 text-gray-400"
                      aria-hidden="true"
                    />
                    {formatDate(domain.expiresAt)}
                  </span>
                ) : null
              }
            />
            <Row
              label="取得日"
              value={domain.createdAt ? formatDate(domain.createdAt) : null}
            />
            <Row label="レジストリ" value={domain.registry || null} />
            <Row
              label="登録者"
              unavailable={registryDown}
              value={
                domain.registrant ? (
                  <span className="inline-flex items-center gap-1.5">
                    <User
                      className="size-4 shrink-0 text-gray-400"
                      aria-hidden="true"
                    />
                    <span className="break-all">{domain.registrant}</span>
                  </span>
                ) : null
              }
            />
            <Row
              label="ネームサーバー"
              unavailable={registryDown}
              value={
                domain.nameservers?.length ? (
                  <ul className="space-y-0.5">
                    {domain.nameservers.map((ns) => (
                      <li key={ns} className="font-mono text-sm break-all">
                        {ns}
                      </li>
                    ))}
                  </ul>
                ) : null
              }
            />
            <Row
              label="レジストリ上の状態"
              unavailable={registryDown}
              value={
                domain.statuses?.length ? (
                  <span className="flex flex-wrap gap-1">
                    {domain.statuses.map((s) => (
                      <span
                        key={s}
                        className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs break-all text-gray-700"
                      >
                        {s}
                      </span>
                    ))}
                  </span>
                ) : null
              }
            />
            <Row
              label="いまの段階"
              unavailable={registryDown}
              value={
                domain.rgpStatus?.length ? (
                  <span className="flex flex-wrap gap-1">
                    {/* レジストリは英語のコードを返す。そのまま出しても伝わらないので言い換える */}
                    {domain.rgpStatus.map((s) => (
                      <span
                        key={s}
                        className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700"
                      >
                        {rgpStatusLabelOf(s)}
                      </span>
                    ))}
                  </span>
                ) : null
              }
            />
            {contacts.length > 0 && (
              <Row
                label="連絡先"
              unavailable={registryDown}
                value={
                  <ul className="space-y-0.5">
                    {contacts.map(([role, id]) => (
                      <li key={role} className="text-sm">
                        <span className="text-gray-500">{role}: </span>
                        <span className="font-mono break-all">{id || "—"}</span>
                      </li>
                    ))}
                  </ul>
                }
              />
            )}
            <Row
              label="最終更新"
              unavailable={registryDown}
              value={domain.upDate ? formatDate(domain.upDate) : null}
            />
            <Row
              label="移管日"
              unavailable={registryDown}
              value={domain.trDate ? formatDate(domain.trDate) : null}
            />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
