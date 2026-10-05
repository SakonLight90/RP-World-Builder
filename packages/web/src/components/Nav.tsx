"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "../i18n/provider";

/**
 * Navigation entries.
 *
 * Fewer entries than the original, on purpose. No Music
 * or Arcane Shop: this project has no soundtrack and no shop,
 * and an entry leading to an empty page is noise. What remains is what
 * you need to play.
 *
 * `messageKey` instead of a written `label`: the list stays a module constant,
 * with no hook in it, and the language decides what each entry says at render.
 */
export const NAV = [
  { href: "/", icon: "🏠", messageKey: "nav.item.home" },
  { href: "/explore", icon: "🪐", messageKey: "nav.item.explore" },
  { href: "/create", icon: "🎭", messageKey: "nav.item.create" },
  { href: "/chats", icon: "💬", messageKey: "nav.item.chats" },
  { href: "/setup", icon: "🔔", messageKey: "nav.item.setup" },
] as const;

function items(pathname: string) {
  return NAV.map((item) => ({
    ...item,
    current: item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  }));
}

export function Sidebar() {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <aside className="side">
      <div className="side-logo">
        <span className="side-logo-mark" aria-hidden="true">
          ⚔
        </span>
        <span className="side-logo-text">RP WORLD BUILDER</span>
      </div>

      <nav aria-label={t("nav.aria.primary")}>
        {items(pathname).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="side-item"
            aria-current={item.current ? "page" : undefined}
          >
            <span className="side-ico" aria-hidden="true">
              {item.icon}
            </span>
            {t(item.messageKey)}
          </Link>
        ))}
      </nav>

      <div className="side-foot">
        {/* The original has wallet and app-store buttons here.
            The three things this project can honestly say: your data never
            leaves, it costs nothing, and nobody measures how you use it.

            The third pill says "no telemetry" and not "works offline",
            because the latter would be false: the narrator is a model and the
            model answers over the network, via opencode. What stays on your
            computer are canon, campaign and chapters. */}
        <div className="side-pill">
          <span aria-hidden="true">🔒</span>
          <span>
            <b>{t("nav.pill.localTitle")}</b>
            <br />
            {t("nav.pill.localBody")}
          </span>
        </div>
        <div className="side-pill">
          <span aria-hidden="true">💸</span>
          <span>
            <b>{t("nav.pill.freeTitle")}</b>
            <br />
            {t("nav.pill.freeBody")}
          </span>
        </div>
        <div className="side-pill">
          <span aria-hidden="true">📊</span>
          <span>
            <b>{t("nav.pill.noTelemetryTitle")}</b>
            <br />
            {t("nav.pill.noTelemetryBody")}
          </span>
        </div>
      </div>
    </aside>
  );
}
