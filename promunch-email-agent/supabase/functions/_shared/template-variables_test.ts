import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildVariables, incomingLabels, MAX_VARIABLE_LABEL, storedLabels } from "./template-variables.ts";

Deno.test("incomingLabels: array aligned to blanks, blanks with no name skipped", () => {
  assertEquals(incomingLabels(["First name", "", "  Offer details  "]), { "1": "First name", "3": "Offer details" });
});

Deno.test("incomingLabels: map form, junk ignored", () => {
  assertEquals(incomingLabels({ "1": "First name", x: "nope", "2": 5 }), { "1": "First name" });
  assertEquals(incomingLabels(null), {});
  assertEquals(incomingLabels("First name"), {});
});

Deno.test("incomingLabels: caps long labels", () => {
  assertEquals(incomingLabels(["x".repeat(200)])["1"].length, MAX_VARIABLE_LABEL);
});

Deno.test("storedLabels: reads labels, tolerates rows without them", () => {
  assertEquals(storedLabels([{ name: "1", sample: "Aarav", label: "First name" }, { name: "2", sample: "10%" }]), { "1": "First name" });
  assertEquals(storedLabels(null), {});
  assertEquals(storedLabels({ "1": "x" }), {});
});

Deno.test("buildVariables: unlabelled keeps the legacy shape exactly", () => {
  assertEquals(buildVariables(["Aarav", "10%"]), [{ name: "1", sample: "Aarav" }, { name: "2", sample: "10%" }]);
});

Deno.test("buildVariables: incoming labels win, stored labels fill gaps by blank number", () => {
  assertEquals(
    buildVariables(["Aarav", "10%", "Friday"], { "2": "Discount" }, { "1": "First name", "2": "Old", "4": "Gone" }),
    [
      { name: "1", sample: "Aarav", label: "First name" },
      { name: "2", sample: "10%", label: "Discount" },
      { name: "3", sample: "Friday" },
    ],
  );
});

Deno.test("sync merge: Meta samples + existing row labels are preserved", () => {
  const existing = [{ name: "1", sample: "old", label: "First name" }, { name: "2", sample: "old", label: "Offer details" }];
  const metaSamples = ["Priya", "20% off"];
  assertEquals(buildVariables(metaSamples, {}, storedLabels(existing)), [
    { name: "1", sample: "Priya", label: "First name" },
    { name: "2", sample: "20% off", label: "Offer details" },
  ]);
});
