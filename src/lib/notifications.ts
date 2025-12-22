/**
 * @deprecated Use useSendNotification or useWelcomeNotification hooks instead
 * for React components. This function is kept for non-React contexts.
 */
export async function sendWelcomeNotification(fid: number): Promise<boolean> {
  const response = await fetch("/api/notifications/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fid,
      title: "Welcome to Eliza OTC Desk",
      body: "Start trading with AI-powered negotiation on Base, BSC, and Solana",
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send notification: HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.state === "success";
}

// Re-export hooks for convenience
export {
  useSendNotification,
  useWelcomeNotification,
} from "@/hooks/useNotification";
