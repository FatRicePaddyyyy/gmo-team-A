import { Quote } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface Testimonial {
  text: string;
  author?: string;
  role?: string;
}

interface TestimonialCardsProps {
  heading?: string;
  subheading?: string;
  items: Testimonial[];
}

export function TestimonialCards({
  heading = "お客様の声",
  subheading = "お客様アンケートでいただいた「お名前.comを選んだ理由」を抜粋しました。",
  items,
}: TestimonialCardsProps) {
  return (
    <section className="bg-gray-50 py-12">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="mb-2 text-center text-2xl font-bold text-gray-900">{heading}</h2>
        {subheading && (
          <p className="mb-8 text-center text-sm text-gray-500">{subheading}</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item, i) => (
            <Card key={i} className="border-border bg-white">
              <CardContent className="flex flex-col gap-3 p-5">
                <Quote className="size-6" style={{ color: "var(--brand)" }} aria-hidden="true" />
                <p className="flex-1 text-sm leading-relaxed text-gray-700">{item.text}</p>
                {item.author && (
                  <div className="border-t border-border pt-3">
                    <p className="text-xs font-medium text-gray-900">{item.author}</p>
                    {item.role && (
                      <p className="text-xs text-gray-600">{item.role}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
