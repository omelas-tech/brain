import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CLEAR_AT_BETA, brainTurnHeaders, recallVia, renderBrainContext, withBrainTurn } from "../brain-turn.mjs";

const hit = (id, title) => ({ id, title, receipt: `◉ memory: "${title}" (decision, 3d ago)` });

describe("integrations/api: brain turn", () => {
  it("places a turn-scoped system message right after the user turn", () => {
    const history = [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }];
    const { messages } = withBrainTurn(history, "which database?", { recall: () => [hit("m1", "Orders database")] });
    assert.equal(messages.length, 4);
    assert.deepEqual(messages[2], { role: "user", content: "which database?" });
    assert.equal(messages[3].role, "system");
    assert.equal(messages[3].clear_at, "next_user_message");
    assert.match(messages[3].content, /◉ memory: "Orders database"/);
  });

  it("adds nothing when nothing is recalled", () => {
    const { messages } = withBrainTurn([], "hello there", { recall: () => [] });
    assert.deepEqual(messages, [{ role: "user", content: "hello there" }]);
  });

  it("drops the weakest matches to stay under the budget", () => {
    const many = Array.from({ length: 20 }, (_, i) => hit(`m${i}`, `Memory number ${i} with a fairly long title`));
    const text = renderBrainContext(many, { budgetTokens: 150 });
    assert.ok(Math.ceil(text.length / 4) <= 150);
    assert.match(text, /Memory number 0 /);
    assert.doesNotMatch(text, /Memory number 19 /);
    assert.equal(renderBrainContext(many, { budgetTokens: 10 }), null);
  });

  it("passes the session to brain and fails soft when brain is missing", () => {
    let seen;
    const exec = (bin, args, opts) => { seen = { bin, args, session: opts.env.BRAIN_SESSION_ID }; return "[]"; };
    assert.deepEqual(recallVia("q", { session: "s1", project: "orders", exec }), []);
    assert.deepEqual(seen.args, ["recall", "q", "--top", "3", "--project", "orders"]);
    assert.equal(seen.session, "s1");
    assert.deepEqual(recallVia("q", { exec: () => { throw new Error("ENOENT"); } }), []);
  });

  it("sends the clear_at beta header", () => {
    assert.equal(brainTurnHeaders("k")["anthropic-beta"], CLEAR_AT_BETA);
  });
});
