// PROMUNCH warm-editorial design system — shared presentation components.
// All read tokens from globals.css (--pm-*). Pages compose these; do not
// invent one-off styles.
export { PageHead } from "./PageHead";
export { SectionLabel } from "./SectionLabel";
export { KpiCard } from "./KpiCard";
export type { KpiTone } from "./KpiCard";
export { Panel } from "./Panel";
export { DataTable } from "./DataTable";
export type { Column } from "./DataTable";
export { StatusBadge } from "./StatusBadge";
export type { BadgeTone } from "./StatusBadge";
export { Ring } from "./Ring";
export { MiniBar } from "./MiniBar";
export { StatLine } from "./Stat";
export type { StatItem } from "./Stat";
export { AttentionItem } from "./AttentionItem";
export { HealthPill } from "./HealthPill";
export type { HealthStatus } from "./HealthPill";
export { SearchBar, FilterChips, Toolbar } from "./Toolbar";
export type { Chip } from "./Toolbar";
export { Tabs } from "./Tabs";
export type { Tab } from "./Tabs";
export { EmptyState } from "./EmptyState";
export { InboxLayout } from "./InboxLayout";

// ---- pm v2 (CRM redesign, pm2- classes in globals.css) ----
export { Card } from "./Card";
export { KpiStrip, Kpi } from "./Kpi";
export { Delta, DELTA_TIP } from "./Delta";
export { Pill } from "./Pill";
export type { PillTone } from "./Pill";
export { HBars } from "./HBars";
export type { HBarItem } from "./HBars";
export { StackBar } from "./StackBar";
export type { StackPart } from "./StackBar";
export { LineChart } from "./LineChart";
export type { LineSeries, YFormat } from "./LineChart";
export { BarChart } from "./BarChart";
export type { BarSeries } from "./BarChart";
export { Funnel } from "./Funnel";
export type { FunnelStep } from "./Funnel";
export { Table } from "./Table";
export type { TableCol, TableCard } from "./Table";
export { AttentionList } from "./AttentionList";
export { PeriodPicker } from "./PeriodPicker";
export { Callout } from "./Callout";
export { TooltipLayer } from "./Tooltip";
export { PageHeader } from "./PageHeader";
export type { PageHeaderTab } from "./PageHeader";
export { MoneyFlow } from "./MoneyFlow";
export type { MoneyFlowRow } from "./MoneyFlow";
export { StockRow } from "./StockRow";
