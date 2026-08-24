import { Tag, Users, Settings, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    icon: Tag,
    title: "最安値のドメイン",
    description:
      "いつでもどこよりも安く提供するため、価格の毎日更新とセールを行っております。",
  },
  {
    icon: Users,
    title: "国内シェア No.1",
    description:
      "24時間365日安心サポートやドメインに必要な機能の充実により国内シェア1位を獲得しました。",
  },
  {
    icon: Settings,
    title: "管理がかんたん",
    description:
      "お名前.comのサーバーやメールサービスなどの連携ができて管理がかんたんです。",
  },
  {
    icon: Zap,
    title: "すぐに使える",
    description:
      "ドメインと一緒にサーバーやメールサービスなども最短当日からすぐにお使いいただけます。",
  },
];

export function FeatureCards() {
  return (
    <section className="bg-white py-12">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="mb-8 text-center text-2xl font-bold text-gray-900">
          お名前.comが選ばれる理由
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
                    <Icon className="size-6" style={{ color: "var(--brand)" }} />
                  </div>
                  <h3 className="font-bold text-gray-900">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-gray-500">{f.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
