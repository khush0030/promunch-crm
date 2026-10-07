import { assertEquals } from "jsr:@std/assert";
import {
  influencerContactFields,
  influencerHandleFromOrder,
  instagramUrl,
  isInfluencerOrder,
  orderTagList,
} from "./influencer-order.ts";

Deno.test("isInfluencerOrder: REST comma-string tags", () => {
  assertEquals(isInfluencerOrder({ tags: "Influencer, influencer:riya.eats" }), true);
  assertEquals(isInfluencerOrder({ tags: "INFLUENCER" }), true);
  assertEquals(isInfluencerOrder({ tags: "vip, influencer:abc" }), true);
});

Deno.test("isInfluencerOrder: array tags", () => {
  assertEquals(isInfluencerOrder({ tags: ["Influencer", "influencer:riya.eats"] }), true);
  assertEquals(isInfluencerOrder({ tags: [" influencer "] }), true);
});

Deno.test("isInfluencerOrder: normal and HYPD orders are not influencer orders", () => {
  assertEquals(isInfluencerOrder({ tags: "" }), false);
  assertEquals(isInfluencerOrder({ tags: "Order From HYPD Store, HYPD Creator" }), false);
  assertEquals(isInfluencerOrder({ tags: ["influencers-wishlist", "not influencer"] }), false);
  assertEquals(isInfluencerOrder({ total_price: "0.01" }), false);
  assertEquals(isInfluencerOrder(null), false);
  assertEquals(isInfluencerOrder(undefined), false);
  assertEquals(isInfluencerOrder({ note: "Please deliver to influencer office" }), false);
});

Deno.test("isInfluencerOrder: dispatch note fallback when tags are missing", () => {
  assertEquals(
    isInfluencerOrder({ tags: "", note: "PROMUNCH influencer kit (barter). Deal abc. Creator @riya." }),
    true,
  );
});

Deno.test("orderTagList normalises", () => {
  assertEquals(orderTagList({ tags: "A, b ,,C" }), ["a", "b", "c"]);
  assertEquals(orderTagList({}), []);
});

Deno.test("influencerHandleFromOrder", () => {
  assertEquals(influencerHandleFromOrder({ tags: "Influencer, influencer:Riya.Eats" }), "riya.eats");
  assertEquals(influencerHandleFromOrder({ tags: ["influencer:@foo_bar"] }), "foo_bar");
  assertEquals(influencerHandleFromOrder({ tags: "Influencer" }), null);
  assertEquals(influencerHandleFromOrder({ tags: "influencer:bad handle!" }), null);
});

Deno.test("instagramUrl", () => {
  assertEquals(instagramUrl("riya.eats"), "https://instagram.com/riya.eats");
  assertEquals(instagramUrl("@Riya.Eats"), "https://instagram.com/riya.eats");
});

Deno.test("influencerContactFields merges, never removes", () => {
  const r = influencerContactFields(
    { tags: ["hyped", "Creator"], properties: { utm_source: "ig", instagram_url: "old" } },
    "riya.eats",
  );
  assertEquals(r.tags, ["hyped", "Creator", "influencer"]);
  assertEquals(r.properties, { utm_source: "ig", instagram_url: "https://instagram.com/riya.eats" });
});

Deno.test("influencerContactFields: empty / odd existing values", () => {
  assertEquals(influencerContactFields(null, "abc"), {
    tags: ["influencer", "creator"],
    properties: { instagram_url: "https://instagram.com/abc" },
  });
  assertEquals(influencerContactFields({ tags: null, properties: ["x"] }, null), {
    tags: ["influencer", "creator"],
    properties: {},
  });
});
