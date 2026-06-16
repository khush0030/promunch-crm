import type { ReactNode } from "react";

// Uppercase band label that groups rows ("Performance", "Revenue", …).
export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="pm-sectlab">{children}</div>;
}

export default SectionLabel;
