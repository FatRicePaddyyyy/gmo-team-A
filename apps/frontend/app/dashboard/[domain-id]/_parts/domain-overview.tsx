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

/**
 * レジストリの役割名を日本語にする。
 * ADMIN / BILLING / TECH のままでは、何の連絡先なのか初心者に伝わらない。
 */
const CONTACT_ROLE_LABELS: Record<string, string> = {
  ADMIN: "管理担当",
  BILLING: "請求担当",
  TECH: "技術担当",
};

function contactRoleLabel(role: string): string {
  return CONTACT_ROLE_LABELS[role.toUpperCase()] ?? role;
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
  // 3 ロールとも同じ連絡先か。自分で取得したドメインは必ずこうなる
  // （登録時に ADMIN / TECH / BILLING すべて同じ contactId を割り当てているため）。
  //
  // 移管で入ってきたドメインは他社が作った連絡先を指したままになる
  // （承認しても書き換えていない）。他社も 3 ロールに同じ ID を使っていれば
  // ここは true になるが、そのドメインの持ち主はこの利用者なので
  // 氏名を出して困ることはない。レジストリ内部の ID を見せるより読める。
  const sameContact =
    contacts.length > 0 &&
    contacts.every(([, id]) => id === contacts[0]?.[1]);

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
            {/* 値は自社 DB 由来なので、レジストリが落ちていても出せる。
                unavailable を渡さないのはそのため。 */}
            <Row
              label="登録者"
              value={
                domain.ownerName ? (
                  <span className="inline-flex items-center gap-1.5">
                    <User
                      className="size-4 shrink-0 text-gray-400"
                      aria-hidden="true"
                    />
                    <span className="break-all">{domain.ownerName}</span>
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
            {/* レジストリが落ちているときは連絡先も返らないが、行ごと消すと
                他の項目だけ「いま取得できません」と並ぶことになり不揃いになる。
                取れていないことは同じなので、行は残して同じ書き方に揃える。 */}
            {(contacts.length > 0 || registryDown) && (
              <Row
                label="連絡先"
                unavailable={registryDown}
                value={
                  sameContact ? (
                    // 自分で取得したドメインは 3 ロールとも同じ人になる。
                    // 同じ名前を 3 行並べても情報が増えないので 1 行にまとめる。
                    <span className="break-all">
                      {domain.ownerName || "—"}
                    </span>
                  ) : (
                    // 移管で入ってきたドメインは他社が作った連絡先を指すため、
                    // 3 者が別人でありうる。そのときだけ役割ごとに出す。
                    <ul className="space-y-0.5">
                      {contacts.map(([role, id]) => (
                        <li key={role} className="text-sm">
                          <span className="text-gray-500">
                            {contactRoleLabel(role)}:{" "}
                          </span>
                          <span className="break-all">{id || "—"}</span>
                        </li>
                      ))}
                    </ul>
                  )
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
