// "+919335497559" -> "+91 93354 97559"; anything else as stored.
// Shared by the customers list and the customer detail page so a number
// reads the same on both.
export function prettyPhone(p: string): string {
  const m = p.replace(/\s+/g, "").match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : p;
}
