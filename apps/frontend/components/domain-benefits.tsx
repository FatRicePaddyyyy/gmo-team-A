import { Home, Mail, Repeat, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * 「ドメインを取ると何ができる？」
 *
 * 定義（ドメインとは何か）から入らない。**できるようになること**から入る。
 * 専門用語を使わず、1枚1行で読み切れる長さに保つこと。
 */
const benefits = [
  {
    icon: Home,
    title: "自分だけの住所でサイトを公開できる",
    description: "他人のサービス名が混ざらない、あなただけのURLになります。",
    example: "manabi-blog.com",
  },
  {
    icon: Mail,
    title: "自分の名前のメールを受け取れる",
    description: "無料メールではなく、自分のドメインのアドレスを使えます。",
    example: "you@manabi-blog.com",
  },
  {
    icon: Repeat,
    title: "サービスを変えてもURLを引き継げる",
    description: "ブログサービスを乗り換えても、同じURLのまま続けられます。",
    example: "引っ越しても住所はそのまま",
  },
  {
    icon: ShieldCheck,
    title: "その名前を他の人に取られない",
    description: "世界に1つだけで早い者勝ち。押さえておけば他の人は使えません。",
    example: "1年ごとの更新で持ち続けられます",
  },
];

export function DomainBenefits() {
  return (
    <section id="benefits" className="scroll-mt-16 bg-white py-12">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="mb-2 text-center text-2xl font-bold text-gray-900">
          ドメインを取ると、何ができる？
        </h2>
        <p className="mx-auto mb-8 max-w-2xl text-center text-sm leading-relaxed text-gray-600">
          ドメインは、インターネット上の「あなたの住所」です。
          持っていると、こういうことができるようになります。
        </p>

        <ul className="grid gap-4 sm:grid-cols-2">
          {benefits.map((benefit) => {
            const Icon = benefit.icon;
            return (
              <li key={benefit.title}>
                <Card className="h-full border-border transition-shadow hover:shadow-md">
                  <CardContent className="flex gap-4 p-5">
                    <div
                      className="flex size-11 shrink-0 items-center justify-center rounded-full"
                      style={{ background: "var(--brand-light)" }}
                    >
                      <Icon
                        className="size-5"
                        style={{ color: "var(--brand)" }}
                        aria-hidden="true"
                      />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-gray-900">{benefit.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-gray-600">
                        {benefit.description}
                      </p>
                      <p className="mt-2 inline-block break-all rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
                        {benefit.example}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
