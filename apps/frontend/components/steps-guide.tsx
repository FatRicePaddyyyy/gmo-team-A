import { CheckCircle } from "lucide-react";

export interface Step {
  number: number;
  title: string;
  description: string;
}

interface StepsGuideProps {
  heading?: string;
  steps: Step[];
}

export function StepsGuide({ heading = "登録の流れ", steps }: StepsGuideProps) {
  return (
    <section className="bg-white py-12">
      <div className="mx-auto max-w-4xl px-4">
        {heading && (
          <h2 className="mb-10 text-center text-2xl font-bold text-gray-900">{heading}</h2>
        )}
        <ol className="relative flex flex-col gap-8 md:flex-row md:gap-0">
          {steps.map((step, i) => (
            <li key={step.number} className="relative flex flex-1 flex-col items-center text-center">
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div className="absolute left-1/2 top-6 hidden h-0.5 w-full translate-x-6 bg-gray-200 md:block" />
              )}
              <div
                className="relative z-10 mb-4 flex size-12 items-center justify-center rounded-full text-lg font-bold text-white shadow"
                style={{ background: "var(--brand)" }}
                aria-hidden="true"
              >
                {step.number}
              </div>
              <div className="mb-2 flex items-center gap-1">
                <CheckCircle className="size-4 text-green-600" aria-hidden="true" />
                <h3 className="font-bold text-gray-900">{step.title}</h3>
              </div>
              <p className="max-w-[180px] text-sm leading-relaxed text-gray-600">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
