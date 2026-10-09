// Ticket creation + ops escalation ping now live in _shared/support-ticket.ts
// (moved verbatim, Oct 9 2026) so wa-webhook can raise the same tickets.
export { type TicketInput, changeToTicket, openTicket } from "../_shared/support-ticket.ts";
