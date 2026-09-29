"use client";

// Step 1: pick a pre-written PROMUNCH starter or start from scratch.

import { Gift, Heart, Megaphone, PackageCheck, PenLine, Rocket, Star, type LucideIcon } from "lucide-react";
import { RecipeCard, StepHeader } from "@/components/guide";
import { TEMPLATE_STARTERS, type TemplateStarter } from "@/lib/whatsapp/template-starters";
import { BlankText } from "../bits";
import s from "../templates.module.css";

const ICONS: Record<string, LucideIcon> = {
  general_update: Megaphone,
  product_launch: Rocket,
  festive_offer: Gift,
  back_in_stock: PackageCheck,
  review_request: Star,
  win_back: Heart,
};

const HEADER_WORD: Record<string, string> = { "": "No picture", IMAGE: "With a picture", VIDEO: "With a video", TEXT: "With a title", DOCUMENT: "With a PDF" };

export function StepStart({
  total,
  onPick,
  onScratch,
}: {
  total: number;
  onPick: (s: TemplateStarter) => void;
  onScratch: () => void;
}) {
  return (
    <div className={s.cFull}>
      <StepHeader
        step={1}
        total={total}
        title="Pick a starting point"
        why="Each one is a complete PROMUNCH message you can change. Words in coloured boxes are blanks you fill in, like the customer's first name."
        glossary={["template", "blank_variable", "approval"]}
      />
      <div className={s.starterGrid}>
        {TEMPLATE_STARTERS.map((st) => (
          <RecipeCard
            key={st.key}
            icon={ICONS[st.key] ?? Megaphone}
            title={st.title}
            badge={st.recommended ? "Recommended" : undefined}
            when={st.when}
            sends={`${st.sends} ${HEADER_WORD[st.header_type] ?? ""}.`}
            preview={
              <div className={s.stackTight}>
                {st.benefit && <div className={s.benefit}>{st.benefit}</div>}
                <div className={s.starterPreview}><BlankText text={st.body} labels={st.blankLabels} /></div>
              </div>
            }
            useLabel="Use this"
            onUse={() => onPick(st)}
          />
        ))}
        <RecipeCard
          icon={PenLine}
          title="Start from scratch"
          when="You know exactly what you want to say."
          sends="A blank message. We guide you through each part."
          useLabel="Start from scratch"
          onUse={onScratch}
        />
      </div>
    </div>
  );
}
