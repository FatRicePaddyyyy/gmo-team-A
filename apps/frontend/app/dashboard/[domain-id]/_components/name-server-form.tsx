"use client";

import { useEffect, useState } from "react";
import { Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FeedbackBanner } from "@/components/feedback-banner";
import type { DetailFeedback } from "../_hooks/use-domain-detail.hook";

/** レジストリの一般的な上限 */
const MAX_NAME_SERVERS = 13;

/**
 * 登録に必要な最低台数。
 *
 * 1 台だと、そのサーバーが止まった時点でサイトもメールも巻き添えで止まる。
 * DNS は冗長化が前提の仕組みで、RFC 2182 (BCP 16) も 2 台以上を求めている。
 * .jp のように 2 台以上を登録要件にしているレジストリもある。
 *
 * 弾く以上、なぜ弾いたのかを画面で必ず伝えること。理由の無い制約は
 * 「入力が悪いのか、システムが壊れているのか」の区別がつかない。
 */
const MIN_NAME_SERVERS = 2;

/** ホスト名として最低限の形（ラベルをドットで繋いだもの）か */
const HOSTNAME_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

interface NameServerFormProps {
  current: string[];
  /**
   * レジストリから現在値を取得できていない。
   * このとき current は「空」ではなく「不明」なので、
   * 「変更がありません」のような現在値を前提にした案内を出さない。
   */
  unavailable?: boolean;
  disabled: boolean;
  running: boolean;
  /** この操作の結果。押した場所の近くに出したいので、ページ上部ではなくここに置く */
  feedback: DetailFeedback | null;
  onSubmit: (nameServers: string[]) => Promise<boolean>;
}

/**
 * ネームサーバーの変更。
 *
 * 1 行 1 台のテキストエリアではなく行ごとの入力にしているのは、
 * どの行が不正なのかを個別に示せるようにするため。
 */
export function NameServerForm({
  current,
  unavailable = false,
  disabled,
  running,
  feedback,
  onSubmit,
}: NameServerFormProps) {
  // 最低 2 行は常に出す。空欄は送信時に落とす。
  const toRows = (values: string[]) => {
    const rows = [...values];
    while (rows.length < MIN_NAME_SERVERS) rows.push("");
    return rows;
  };

  const [rows, setRows] = useState<string[]>(() => toRows(current));
  const [error, setError] = useState<string | null>(null);

  // エラーを全入力欄に紐づける（どの行が原因かはメッセージ本文で示す）
  const errorId = "name-server-error";

  // 保存が成功して再取得された値に追従する
  useEffect(() => {
    setRows(toRows(current));
    setError(null);
  }, [current]);

  const setRow = (index: number, value: string) => {
    setRows((prev) => prev.map((row, i) => (i === index ? value : row)));
  };

  const handleSubmit = async () => {
    const values = rows.map((row) => row.trim().toLowerCase()).filter(Boolean);

    if (values.length < MIN_NAME_SERVERS) {
      setError(
        `ネームサーバーは ${MIN_NAME_SERVERS} 台以上の登録が必要です。1 台だけだと、そのサーバーが止まったときにサイトもメールも止まります。`,
      );
      return;
    }
    const invalid = values.find((value) => !HOSTNAME_REGEX.test(value));
    if (invalid) {
      setError(`「${invalid}」はホスト名の形式ではありません（例: ns1.example.com）。`);
      return;
    }
    if (new Set(values).size !== values.length) {
      setError("同じネームサーバーが重複しています。");
      return;
    }

    setError(null);
    await onSubmit(values);
  };

  const isUnchanged =
    JSON.stringify(rows.map((r) => r.trim().toLowerCase()).filter(Boolean)) ===
    JSON.stringify(current);

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-lg font-bold text-gray-900">
            <Server className="size-4 text-gray-400" aria-hidden="true" />
            ネームサーバー
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            このドメインでどのサーバーを使うかの設定です。レンタルサーバーを借りたときに、その会社から指定されたものを入れます。
          </p>
          {/* 保存を押してから弾かれるのでは遅い。入力を始める前に条件を出す */}
          <p className="mt-1 text-xs text-gray-600">
            {MIN_NAME_SERVERS} 台以上の登録が必要です。1
            台だけだと、そのサーバーが止まったときにサイトもメールも止まるためです。
          </p>
        </div>

        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <label
                htmlFor={`ns-${index}`}
                className="w-16 shrink-0 text-xs text-gray-600"
              >
                {index + 1} 台目
              </label>
              <Input
                id={`ns-${index}`}
                value={row}
                placeholder={`ns${index + 1}.example.com`}
                autoComplete="off"
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(event) => setRow(index, event.target.value)}
                className="h-11"
              />
            </div>
          ))}
        </div>

        {rows.length < MAX_NAME_SERVERS && (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => setRows((prev) => [...prev, ""])}
          >
            入力欄を増やす
          </Button>
        )}

        {error && (
          <p id={errorId} role="alert" className="text-xs text-red-700">
            {error}
          </p>
        )}

        {feedback && (
          <FeedbackBanner
              context="nameServers"
            tone={feedback.tone}
            message={feedback.message}
            unauthorized={feedback.unauthorized}
          />
        )}

        <div className="border-t border-gray-100 pt-3">
          <Button
            variant="brand"
            disabled={disabled || isUnchanged}
            onClick={() => void handleSubmit()}
          >
            {running ? "保存中..." : "ネームサーバーを保存"}
          </Button>
          {/* レジストリの現在値が取れていないときは「変更がない」とは言えない。
              空欄と比べて同じに見えるだけなので、誤った断定をしない。 */}
          {isUnchanged && !running && !unavailable && (
            <p className="mt-2 text-xs text-gray-500">
              現在の設定から変更がありません。
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
