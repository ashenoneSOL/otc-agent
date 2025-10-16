"use client";

import { useState } from "react";
import dynamicImport from "next/dynamic";
import { Footer } from "@/components/footer";

const TokenSelectionStep = dynamicImport(
  () =>
    import("@/components/consignment-form/token-selection-step").then(
      (m) => m.TokenSelectionStep,
    ),
  { ssr: false },
);
const AmountStep = dynamicImport(
  () =>
    import("@/components/consignment-form/amount-step").then(
      (m) => m.AmountStep,
    ),
  { ssr: false },
);
const NegotiationParamsStep = dynamicImport(
  () =>
    import("@/components/consignment-form/negotiation-params-step").then(
      (m) => m.NegotiationParamsStep,
    ),
  { ssr: false },
);
const DealStructureStep = dynamicImport(
  () =>
    import("@/components/consignment-form/deal-structure-step").then(
      (m) => m.DealStructureStep,
    ),
  { ssr: false },
);
const ProtectionsStep = dynamicImport(
  () =>
    import("@/components/consignment-form/protections-step").then(
      (m) => m.ProtectionsStep,
    ),
  { ssr: false },
);
const ReviewStep = dynamicImport(
  () =>
    import("@/components/consignment-form/review-step").then(
      (m) => m.ReviewStep,
    ),
  { ssr: false },
);

export const dynamic = "force-dynamic";

export default function ConsignPage() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    tokenId: "",
    amount: "",
    isNegotiable: true,
    fixedDiscountBps: 1000,
    fixedLockupDays: 180,
    minDiscountBps: 500,
    maxDiscountBps: 2000,
    minLockupDays: 7,
    maxLockupDays: 365,
    minDealAmount: "",
    maxDealAmount: "",
    isFractionalized: true,
    isPrivate: false,
    allowedBuyers: [] as string[],
    maxPriceVolatilityBps: 1000,
    maxTimeToExecuteSeconds: 1800,
  });

  const updateFormData = (updates: Partial<typeof formData>) => {
    setFormData({ ...formData, ...updates });
  };

  const steps = [
    { number: 1, title: "Select Token", component: TokenSelectionStep },
    { number: 2, title: "Amount", component: AmountStep },
    { number: 3, title: "Terms", component: NegotiationParamsStep },
    { number: 4, title: "Structure", component: DealStructureStep },
    { number: 5, title: "Protections", component: ProtectionsStep },
    { number: 6, title: "Review", component: ReviewStep },
  ];

  const CurrentStepComponent = steps[step - 1].component;

  return (
    <>
      <main className="flex-1 px-3 sm:px-4 md:px-6 py-4 sm:py-6 md:py-8">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">List Your Tokens for OTC</h1>
          <p className="text-sm sm:text-base text-zinc-600 dark:text-zinc-400 mb-6 sm:mb-8">
            Create a consignment to offer your tokens at discounted rates
          </p>

          <div className="flex items-center justify-between mb-6 sm:mb-8 overflow-x-auto pb-2">
            {steps.map((s) => (
              <div
                key={s.number}
                className={`flex items-center flex-shrink-0 ${
                  s.number < steps.length ? "flex-1" : ""
                }`}
              >
                <div
                  className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-semibold flex-shrink-0 ${
                    step === s.number
                      ? "bg-zinc-800 text-white"
                      : step > s.number
                        ? "bg-zinc-800/20 text-zinc-800"
                        : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600"
                  }`}
                >
                  {s.number}
                </div>
                {s.number < steps.length && (
                  <div
                    className={`flex-1 h-0.5 sm:h-1 mx-1 sm:mx-2 ${
                      step > s.number
                        ? "bg-orange-600"
                        : "bg-zinc-200 dark:bg-zinc-800"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 md:p-8">
            <h2 className="text-lg sm:text-xl font-semibold mb-4 sm:mb-6">
              {steps[step - 1].title}
            </h2>
            <CurrentStepComponent
              formData={formData}
              updateFormData={updateFormData}
              onNext={() => setStep(step + 1)}
              onBack={() => setStep(step - 1)}
            />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
