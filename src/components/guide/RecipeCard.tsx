import type { LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import s from "./guide.module.css";

export type RecipeBadge = "Recommended" | "Live" | "Draft" | "Needs template" | "Owner only";

const BADGE_TONE: Record<RecipeBadge, string> = {
  Recommended: "brand",
  Live: "good",
  Draft: "neu",
  "Needs template": "warn",
  "Owner only": "info",
};

/**
 * Card describing a ready-made automation ("recipe"): icon, title, badge, and
 * plain rows for When / Wait / Sends plus an optional message preview.
 * The action button shows `useLabel` (default "Use this"); when `disabled`,
 * `disabledReason` is shown under the button and linked via aria-describedby.
 * `icon` is a lucide-react component (e.g. ShoppingCart).
 */
export function RecipeCard({
  icon: Icon,
  title,
  when,
  wait,
  sends,
  preview,
  badge,
  onUse,
  useLabel = "Use this",
  disabled = false,
  disabledReason,
}: {
  icon: LucideIcon;
  title: string;
  when: string;
  wait?: string;
  sends: string;
  preview?: ReactNode;
  badge?: RecipeBadge;
  onUse?: () => void;
  useLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const uid = useId();
  const reasonId = `${uid}-why`;
  return (
    <article className={s.recipe} aria-labelledby={`${uid}-t`}>
      <div className={s.recipeHead}>
        <span className={s.recipeIcon} aria-hidden="true">
          <Icon />
        </span>
        <h3 id={`${uid}-t`} className={s.recipeTitle}>{title}</h3>
        {badge && <span className={`pm2-pill ${BADGE_TONE[badge]} ${s.recipeBadge}`}>{badge}</span>}
      </div>
      <dl className={s.recipeRows}>
        <div>
          <dt>When</dt>
          <dd>{when}</dd>
        </div>
        {wait && (
          <div>
            <dt>Wait</dt>
            <dd>{wait}</dd>
          </div>
        )}
        <div>
          <dt>Sends</dt>
          <dd>{sends}</dd>
        </div>
      </dl>
      {preview != null && <div className={s.recipePreview}>{preview}</div>}
      {onUse && (
        <div className={s.recipeFoot}>
          <button
            type="button"
            className="pm2-btn sm pri"
            onClick={onUse}
            disabled={disabled}
            aria-describedby={disabled && disabledReason ? reasonId : undefined}
          >
            {useLabel}
          </button>
          {disabled && disabledReason && (
            <span id={reasonId} className={s.recipeWhy}>{disabledReason}</span>
          )}
        </div>
      )}
    </article>
  );
}

export default RecipeCard;
