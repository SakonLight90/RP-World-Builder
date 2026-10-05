import type { ReactNode } from "react";
import { Sidebar } from "../../components/Nav";

/**
 * The site frame: sidebar on the left and watermark at the bottom.
 *
 * Every non-world page uses this. The `(chat)` group has its own,
 * because inside a world the sidebar doesn't fit.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Sidebar />
      <div className="frame">
        {children}
        <span className="watermark" aria-hidden="true">
          ✦
        </span>
      </div>
    </>
  );
}
