"use client";

// "Create an automation": ready-made recipes. Each maps to what the engine
// really supports: a built-in automation that already runs, a custom
// automation (trigger + wait + message), or "Coming soon".

import { Gift, HeartHandshake, MessageCircleHeart, PlusCircle, RefreshCw, ShoppingCart, Star, type LucideIcon } from "lucide-react";
import { RecipeCard } from "@/components/guide";
import { RECIPES, type Recipe, type RecipeKey } from "./logic";
import s from "./flows.module.css";

const ICONS: Record<RecipeKey, LucideIcon> = {
  welcome: MessageCircleHeart,
  abandoned_cart: ShoppingCart,
  review: Star,
  restock: RefreshCw,
  winback: HeartHandshake,
  cross_sell: Gift,
};

export function RecipeGallery({ builtInOn, onUse, onShowBuiltIn, onBlank, onClose }: {
  builtInOn: Record<string, boolean>;
  onUse: (r: Recipe) => void;
  onShowBuiltIn: (card: string) => void;
  onBlank: () => void;
  onClose: () => void;
}) {
  return (
    <section className={s.section} aria-labelledby="recipes-title">
      <div className={s.sectionHead}>
        <h2 id="recipes-title" className={s.sectionTitle}>Create an automation</h2>
        <p className={s.sectionSub}>Pick a ready-made idea. You choose the wait and the message, check it, then turn it on when you are happy.</p>
        <button type="button" className="pm2-btn sm ghost" onClick={onClose}>Close</button>
      </div>
      <div className={s.gallery}>
        {RECIPES.map((r) => {
          const a = r.availability;
          if (a.kind === "builtin") {
            const on = builtInOn[a.card];
            return (
              <RecipeCard key={r.key} icon={ICONS[r.key]} title={r.title} when={r.when} wait={r.wait} sends={r.sends}
                badge={on ? "Live" : undefined}
                useLabel={on ? "Already running: view it" : "Built in: view and turn on"}
                onUse={() => onShowBuiltIn(a.card)} />
            );
          }
          if (a.kind === "soon") {
            return (
              <RecipeCard key={r.key} icon={ICONS[r.key]} title={r.title} when={r.when} wait={r.wait} sends={r.sends}
                useLabel="Coming soon" disabled disabledReason={a.why} onUse={() => undefined} />
            );
          }
          return (
            <RecipeCard key={r.key} icon={ICONS[r.key]} title={r.title} when={r.when} wait={r.wait} sends={r.sends}
              badge="Recommended" onUse={() => onUse(r)} />
          );
        })}
        <RecipeCard icon={PlusCircle} title="Start from scratch" when="An order is placed, shipped, or a cart is left behind"
          sends="Any approved marketing message" useLabel="Build my own" onUse={onBlank} />
      </div>
    </section>
  );
}
