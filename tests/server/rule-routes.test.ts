import { describe, expect, test } from "bun:test";
import { RuleDetailSchema, RulesResponseSchema } from "../../src/shared/api.ts";
import { getRule, insertRules } from "../../src/store/rules.ts";
import { SEED_NOW } from "../helpers/seed.ts";
import { testContext } from "./helpers.ts";

function seedRules(harness: ReturnType<typeof testContext>) {
	return insertRules(
		harness.db,
		harness.repoId,
		harness.entryId,
		[
			{
				type: "testing",
				directive: "Zebra: always add a regression test.",
				rationale: "Reviewers blocked untested fixes.",
				scope_globs: ["services/payments/**"],
				confidence: 0.9,
				source_comment_urls: [],
				file_slug: "zebra-always-add-a-regression-test",
			},
			{
				type: "security",
				directive: "Alpha: never round with floats.",
				rationale: "Money is integers.",
				scope_globs: [],
				confidence: 0.7,
				source_comment_urls: [],
				file_slug: "alpha-never-round-with-floats",
			},
		],
		SEED_NOW,
	);
}

describe("rule routes", () => {
	test("GET rules returns every rule with denormalised provenance", async () => {
		const harness = testContext();
		seedRules(harness);
		const body = RulesResponseSchema.parse(
			await (
				await harness.app.request(`/api/repos/${harness.repoId}/rules`)
			).json(),
		);
		expect(body.rules).toHaveLength(2);
		expect(body.counts.draft).toBe(2);
		expect(body.counts.total).toBe(2);
		expect(body.rules[0]?.source_number).toBe(4821);
		harness.close();
	});

	test("GET rules filters by status and by substring", async () => {
		const harness = testContext();
		seedRules(harness);
		const verified = RulesResponseSchema.parse(
			await (
				await harness.app.request(
					`/api/repos/${harness.repoId}/rules?status=verified`,
				)
			).json(),
		);
		expect(verified.rules).toHaveLength(0);
		expect(verified.counts.draft).toBe(2);

		const floats = RulesResponseSchema.parse(
			await (
				await harness.app.request(`/api/repos/${harness.repoId}/rules?q=floats`)
			).json(),
		);
		expect(floats.rules).toHaveLength(1);
		harness.close();
	});

	test("GET rules rejects an unknown status with 400", async () => {
		const harness = testContext();
		const response = await harness.app.request(
			`/api/repos/${harness.repoId}/rules?status=pending`,
		);
		expect(response.status).toBe(400);
		harness.close();
	});

	test("GET /api/rules/:id previews the file that would be committed", async () => {
		const harness = testContext();
		const [rule] = seedRules(harness);
		if (!rule) throw new Error("seed rule vanished");
		const detail = RuleDetailSchema.parse(
			await (await harness.app.request(`/api/rules/${rule.id}`)).json(),
		);
		expect(detail.file_path).toBe(
			".claude/rules/zebra-always-add-a-regression-test.md",
		);
		expect(detail.file_preview).toContain("notam: true");
		harness.close();
	});

	test("POST /api/rules/status abandons a selection and publishes a rules event", async () => {
		const harness = testContext();
		const rules = seedRules(harness);
		let rulesEvents = 0;
		harness.ctx.bus.subscribe((event) => {
			if (event.type === "rules") rulesEvents++;
		});
		const response = await harness.app.request("/api/rules/status", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				rule_ids: rules.map((rule) => rule.id),
				status: "abandoned",
			}),
		});
		expect(response.status).toBe(200);
		for (const rule of rules) {
			expect(getRule(harness.db, rule.id)?.status).toBe("abandoned");
		}
		expect(rulesEvents).toBe(1);
		harness.close();
	});

	test("an unknown rule id is a 404 in the shared envelope, and moves nothing", async () => {
		const harness = testContext();
		const rules = seedRules(harness);
		const ids = rules.map((rule) => rule.id);
		const response = await harness.app.request("/api/rules/status", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				rule_ids: [...ids, "ru_nope"],
				status: "abandoned",
			}),
		});
		expect(response.status).toBe(404);
		const body = (await response.json()) as { error: { message: string } };
		expect(body.error.message).toBe("No rule with id ru_nope");
		expect(getRule(harness.db, ids[0] as string)?.status).toBe("draft");
		harness.close();
	});

	test("POST /api/rules/delete removes an abandoned selection and publishes a rules event", async () => {
		const harness = testContext();
		const rules = seedRules(harness);
		const ids = rules.map((rule) => rule.id);
		await harness.app.request("/api/rules/status", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ rule_ids: ids, status: "abandoned" }),
		});
		let rulesEvents = 0;
		harness.ctx.bus.subscribe((event) => {
			if (event.type === "rules") rulesEvents++;
		});
		const response = await harness.app.request("/api/rules/delete", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ rule_ids: ids }),
		});
		expect(response.status).toBe(200);
		const returned = (await response.json()) as string[];
		expect(returned.toSorted()).toEqual(ids.toSorted());
		for (const id of ids) expect(getRule(harness.db, id)).toBeNull();
		expect(rulesEvents).toBe(1);
		harness.close();
	});

	test("deleting a rule that is not abandoned is a 409 and removes nothing", async () => {
		const harness = testContext();
		const rules = seedRules(harness);
		const ids = rules.map((rule) => rule.id);
		const response = await harness.app.request("/api/rules/delete", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ rule_ids: ids }),
		});
		expect(response.status).toBe(409);
		const body = (await response.json()) as { error: { message: string } };
		expect(body.error.message).toContain("only an abandoned rule");
		expect(getRule(harness.db, ids[0] as string)?.status).toBe("draft");
		harness.close();
	});

	test("deleting an unknown rule id is a 404 in the shared envelope, and removes nothing", async () => {
		const harness = testContext();
		const rules = seedRules(harness);
		const ids = rules.map((rule) => rule.id);
		await harness.app.request("/api/rules/status", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ rule_ids: ids, status: "abandoned" }),
		});
		const response = await harness.app.request("/api/rules/delete", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ rule_ids: [...ids, "ru_nope"] }),
		});
		expect(response.status).toBe(404);
		const body = (await response.json()) as { error: { message: string } };
		expect(body.error.message).toBe("No rule with id ru_nope");
		expect(getRule(harness.db, ids[0] as string)?.status).toBe("abandoned");
		harness.close();
	});

	test("an illegal transition is a 409 and changes nothing", async () => {
		const harness = testContext();
		const rules = seedRules(harness);
		const ids = rules.map((rule) => rule.id);
		const body = JSON.stringify({ rule_ids: ids, status: "verified" });
		// draft -> verified is not a legal edge.
		const response = await harness.app.request("/api/rules/status", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
		});
		expect(response.status).toBe(409);
		expect(getRule(harness.db, ids[0] as string)?.status).toBe("draft");
		harness.close();
	});
});
