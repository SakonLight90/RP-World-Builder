import type { ReactNode } from "react";

/**
 * A world's frame: no sidebar, no watermark.
 *
 * Inside a world the screen belongs to the story. The sidebar would sit like a
 * binder in the front row, forcing the reading window to shrink — the only thing
 * that matters here. The back arrow top-left exits from there.
 */
export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <div className="frame" style={{ paddingBottom: 0 }}>
      {children}
    </div>
  );
}
