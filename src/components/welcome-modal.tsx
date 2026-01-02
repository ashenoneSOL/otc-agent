"use client";

import { XMarkIcon } from "@heroicons/react/24/outline";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import Card from "@/components/card";
import { Dialog } from "@/components/dialog";

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WelcomeModal({ isOpen, onClose }: WelcomeModalProps) {
  const router = useRouter();

  const handleOpenConsignmentForm = useCallback(() => {
    onClose();
    router.push("/consign");
  }, [router, onClose]);

  const handleOpenTradingDesk = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleViewDeals = useCallback(() => {
    onClose();
    router.push("/my-deals");
  }, [router, onClose]);

  return (
    <Dialog open={isOpen} onClose={onClose} size="5xl">
      <div className="relative flex flex-col rounded-2xl overflow-hidden bg-surface min-h-[500px] sm:min-h-[600px]">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
        >
          <XMarkIcon className="h-5 w-5 text-white" />
          <span className="sr-only">Close</span>
        </button>

        {/* Background with gradient overlay */}
        <div className="absolute inset-0">
          {/* Background */}
          <div className="absolute inset-0 bg-surface" />

          {/* Background image positioned on the right */}
          <div className="absolute inset-0 flex justify-end">
            <Image
              src="/how-it-works/how-it-works-bg.png"
              alt="How it works background"
              width={1200}
              height={900}
              className="object-cover h-auto"
              priority
            />
          </div>

          {/* Gradient overlay - black on left fading to transparent on right */}
          <div
            className="absolute inset-0 bg-gradient-to-r from-black via-black to-transparent"
            style={{
              background:
                "linear-gradient(to right, rgba(16, 16, 16, 1) 0%, #000000 55%, rgba(0,0,0,0.3) 75%)",
            }}
          />
        </div>

        {/* Content */}
        <div className="relative flex flex-col items-start justify-center flex-1 p-6 sm:p-8 lg:p-12">
          <div className="flex flex-col items-start">
            <h1
              className="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-bold text-white leading-tight tracking-tight"
              aria-level={1}
            >
              Buy & Sell Tokens
              <br />
              Over-the-Counter
            </h1>
            <p className="mt-2 lg:mt-4 text-base sm:text-lg text-zinc-300 max-w-xl leading-relaxed">
              Permissionless, peer-to-peer OTC deals.
            </p>
          </div>

          {/* Cards - vertical stack on mobile, horizontal row on desktop */}
          <div className="flex flex-col lg:flex-row gap-3 sm:gap-4 mt-6 lg:mt-8 w-full">
            <Card
              number="1"
              title="List A Token"
              description="Consign your tokens at a discount with lockup."
              button="Create Listing"
              onClick={handleOpenConsignmentForm}
            />
            <Card
              number="2"
              title="Negotiate"
              description="Make an offer with AI-negotiated deals."
              button="Open Trading Desk"
              onClick={handleOpenTradingDesk}
            />
            <Card
              number="3"
              title="Private Deals"
              description="Fixed price and private deals available."
              button="View My Deals"
              onClick={handleViewDeals}
            />
          </div>
        </div>

        {/* Gradient glow effect */}
        <div
          className="absolute bottom-0 right-0 w-full h-2/3 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 80% 100% at 100% 100%, var(--brand-primary) 0%, rgba(247, 91, 30, 0.6) 0%, rgba(247, 91, 30, 0.3) 0%, transparent 75%)`,
            filter: "blur(2px)",
          }}
        />
      </div>
    </Dialog>
  );
}
