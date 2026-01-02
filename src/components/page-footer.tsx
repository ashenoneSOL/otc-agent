import Link from "next/link";

export function PageFooter() {
  return (
    <footer className="flex-shrink-0 px-4 sm:px-6 py-3 border-t border-zinc-800">
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-4 text-xs text-zinc-500">
        <Link href="/terms" className="hover:text-zinc-300 transition-colors">
          Terms of Service
        </Link>
        <span className="text-zinc-700">•</span>
        <Link href="/privacy" className="hover:text-zinc-300 transition-colors">
          Privacy Policy
        </Link>
      </div>
    </footer>
  );
}
