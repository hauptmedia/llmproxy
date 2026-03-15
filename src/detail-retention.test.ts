import assert from "node:assert/strict";
import test from "node:test";
import { compactJsonForRetention } from "./detail-retention";

test("compacts oversized retained detail strings", () => {
  const compacted = compactJsonForRetention({
    messages: [
      {
        role: "user",
        content: "a".repeat(80_000),
      },
    ],
    nested: {
      reasoning: "b".repeat(80_000),
    },
  });

  const messageContent = (compacted as Record<string, any>).messages[0].content as string;
  const nestedReasoning = (compacted as Record<string, any>).nested.reasoning as string;

  assert.match(messageContent, /\[llmproxy truncated to reduce memory usage\]/);
  assert.match(nestedReasoning, /\[llmproxy truncated to reduce memory usage\]/);
  assert.ok(messageContent.length < 17_000);
  assert.ok(nestedReasoning.length < 17_000);
});

test("caps retained arrays and wide objects", () => {
  const compacted = compactJsonForRetention({
    messages: Array.from({ length: 80 }, (_, index) => ({
      role: "user",
      content: `message-${index}`,
    })),
    metadata: Object.fromEntries(
      Array.from({ length: 160 }, (_, index) => [`field_${index}`, `value-${index}`]),
    ),
  }) as Record<string, any>;

  assert.equal(Array.isArray(compacted.messages), true);
  assert.equal(compacted.messages.length, 24);
  assert.equal(compacted.messages[0].content, "message-0");
  assert.equal(compacted.messages[23].content, "message-23");

  assert.equal(compacted.metadata.field_0, "value-0");
  assert.equal(compacted.metadata.field_63, "value-63");
  assert.equal("field_64" in compacted.metadata, false);
  assert.equal(compacted.metadata.__llmproxy_truncated_keys__, 96);
});
