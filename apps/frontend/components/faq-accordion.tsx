"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export interface FaqItem {
  question: string;
  answer: string;
}

interface FaqAccordionProps {
  heading?: string;
  items: FaqItem[];
}

export function FaqAccordion({ heading = "よくあるご質問", items }: FaqAccordionProps) {
  return (
    <section className="py-12">
      <div className="mx-auto max-w-3xl px-4">
        <h2 className="mb-8 text-center text-2xl font-bold text-gray-900">{heading}</h2>
        <Accordion className="w-full space-y-2">
          {items.map((item, i) => (
            <AccordionItem
              key={i}
              value={`item-${i}`}
              className="rounded-lg border border-border bg-white px-4"
            >
              <AccordionTrigger className="text-left font-medium text-gray-900 hover:no-underline [&>svg]:text-[var(--brand)]">
                <span className="mr-3 font-bold" style={{ color: "var(--brand)" }}>
                  Q.
                </span>
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-gray-600">
                <span className="mr-3 font-bold text-green-600">A.</span>
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
