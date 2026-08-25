import { Globe, CalendarClock, UserRoundSearch, Ruler } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/** ドメインを決める前に知っておきたいこと。学習の入口として一等地に置く */
const features = [
  {
    icon: Globe,
    title: "末尾（TLD）で条件が変わる",
    description:
      ".com は誰でも、.jp は日本に住所がある人、.co.jp は日本の法人だけ。価格より先に「自分が取れるか」を確認します。",
  },
  {
    icon: CalendarClock,
    title: "ドメインは毎年の更新制",
    description:
      "買い切りではなく1年ごとの使用権です。初年度0円でも2年目から更新料がかかります。払い忘れると使えなくなります。",
  },
  {
    icon: UserRoundSearch,
    title: "登録者の情報は公開される",
    description:
      "氏名・住所・電話番号が Whois で公開されます。個人の方は無料の「公開代行」を使えば、あなたの情報は表示されません。",
  },
  {
    icon: Ruler,
    title: "名前は短く・打ちやすく",
    description:
      "口頭で伝えられて、打ち間違えにくい長さが目安です。ハイフンや数字を多く使うと説明しづらくなります。",
  },
];

export function FeatureCards() {
  return (
    <section className="bg-white py-12">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="mb-8 text-center text-2xl font-bold text-gray-900">
          ドメインを決める前に知っておきたい4つのこと
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title} className="border-border text-center transition-shadow hover:shadow-md">
                <CardContent className="flex flex-col items-center gap-3 p-6">
                  <div
                    className="flex size-12 items-center justify-center rounded-full"
                    style={{ background: "var(--brand-light)" }}
                  >
                    <Icon className="size-6" style={{ color: "var(--brand)" }} aria-hidden="true" />
                  </div>
                  <h3 className="font-bold text-gray-900">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-gray-600">{f.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
