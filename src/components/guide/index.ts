// PROMUNCH guidance kit: plain-English help for the WhatsApp marketing screens.
//
//   <HelpTip term="held_back" />                      small "?" with a popover
//   <HelpTip text="Anything you like" label="..." />  one-off explanation
//   <GlossaryTerm k="window_24h">24h window</GlossaryTerm>   dotted-underline word, same popover
//   GLOSSARY[key] -> { term, plain, customerEffect?, learnMoreHref? }
//   <GuideChecklist id="wa-setup" title="..." items={[{ key, label, done, help?, cta? }]} dismissible />
//   <StepHeader step={2} total={5} title="..." why="..." glossary={["opted_in"]} />
//   <NextStepCallout tone="warn" title="..." body="..." primary={{ label, href }} secondary={{ label, onClick }} />
//   <RecipeCard icon={ShoppingCart} title="..." when="..." wait="..." sends="..." badge="Recommended" onUse={fn} />
//   <FlowTimeline steps={[{ kind: "trigger", title: "..." }, ...]} />   vertical under 640px
//   <PlainSummary sentences={["...", "..."]} />
//
// Popovers: hover, focus or click (click pins), Escape / outside click closes,
// clamped to the viewport so they fit a 390px phone. Colours come from pm
// tokens only (guide.module.css). Icons are lucide-react (RecipeCard.icon is a
// LucideIcon). Actions with `href` render next/link, otherwise a button.
// Copy rules for anything passed in: PROMUNCH in caps, no em dashes.
export { HelpTip } from "./HelpTip";
export { GlossaryTerm } from "./GlossaryTerm";
export { GLOSSARY, GLOSSARY_KEYS } from "./glossary";
export type { GlossaryKey, GlossaryEntry } from "./glossary";
export { GuideChecklist } from "./GuideChecklist";
export type { GuideChecklistItem, GuideAction } from "./GuideChecklist";
export { StepHeader } from "./StepHeader";
export { NextStepCallout } from "./NextStepCallout";
export { RecipeCard } from "./RecipeCard";
export type { RecipeBadge } from "./RecipeCard";
export { FlowTimeline } from "./FlowTimeline";
export type { FlowStep, FlowStepKind } from "./FlowTimeline";
export { PlainSummary } from "./PlainSummary";
