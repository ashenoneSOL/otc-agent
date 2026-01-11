import { Suspense } from "react";
import { PageFooter } from "../../../components/page-footer";
import { MyDealsContent } from "./MyDealsContent";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <Suspense
        fallback={
          <main className="flex-1 min-h-[60dvh] flex items-center justify-center">
            <div className="text-center space-y-4">
              <h1 className="text-2xl font-semibold">My Deals</h1>
              <p className="text-zinc-600 dark:text-zinc-400">Loading...</p>
            </div>
          </main>
        }
      >
        <MyDealsContent />
      </Suspense>
      <PageFooter />
    </div>
  );
}
