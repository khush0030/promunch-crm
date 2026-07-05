import { useEffect } from "react";

// Close-on-Escape for the leads modals (which use their own overlay markup
// rather than the shared WhatsApp Modal). Keeps behavior identical to a
// backdrop click.
export function useEscapeKey(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}
