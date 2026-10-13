import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/server/errors";
import { assertSameOrigin, handle, MAX_JSON_BYTES, parseOrThrow, readJson, requireUser, wellFormedId } from "@/lib/server/http";

const req = (init: RequestInit & { url?: string } = {}) => new Request(init.url ?? "http://localhost:3100/api/x", init);
const body = async (r: Response) => ({ status: r.status, json: await r.json() });

describe("handle()", () => {
  it("turns AppError into its status and a safe JSON body", async () => {
    const r = await handle(async () => {
      throw new AppError(409, "UNAVAILABLE", "Ces dates ne sont plus disponibles.");
    })();
    expect(await body(r)).toEqual({ status: 409, json: { error: { code: "UNAVAILABLE", message: "Ces dates ne sont plus disponibles." } } });
  });

  it("hides unexpected errors behind a generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handle(async () => {
      throw new Error("connection to 10.0.0.5:5432 refused, password=hunter2");
    })();
    const { status, json } = await body(r);
    expect(status).toBe(500);
    expect(JSON.stringify(json)).not.toMatch(/10\.0\.0\.5|hunter2|stack/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("passes successful responses through", async () => {
    const r = await handle(async () => Response.json({ ok: true }, { status: 201 }))();
    expect(await body(r)).toEqual({ status: 201, json: { ok: true } });
  });
});

describe("assertSameOrigin()", () => {
  it("accepts same-origin and Origin-less requests, rejects others", () => {
    expect(() => assertSameOrigin(req({ headers: { origin: "http://localhost:3100" } }))).not.toThrow();
    expect(() => assertSameOrigin(req())).not.toThrow();
    for (const origin of ["https://evil.example", "http://localhost:3101", "null", "http://localhost:3100.evil.example"]) {
      expect(() => assertSameOrigin(req({ headers: { origin } }))).toThrow(AppError);
    }
  });
});

describe("input parsing", () => {
  const schema = z.object({ adults: z.number().int().min(1) });

  it("rejects malformed JSON with 400", async () => {
    await expect(readJson(req({ method: "POST", body: "{nope" }), schema)).rejects.toMatchObject({ status: 400, code: "INVALID_JSON" });
  });

  it("caps the body size: 413 on a declared or streamed body over the limit", async () => {
    const big = JSON.stringify({ adults: 2, pad: "x".repeat(MAX_JSON_BYTES) });
    await expect(readJson(req({ method: "POST", body: big }), schema)).rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    await expect(readJson(req({ method: "POST", body: JSON.stringify({ adults: 2 }) }), schema, { maxBytes: 5 })).rejects.toMatchObject({
      status: 413,
    });
    await expect(readJson(req({ method: "POST", body: JSON.stringify({ adults: 2 }) }), schema)).resolves.toEqual({ adults: 2 });
  });

  it("answers malformed ids as unknown (404) without a query", () => {
    expect(wellFormedId("1009")).toBe("1009");
    expect(wellFormedId("cmg5x0abc_d-1")).toBe("cmg5x0abc_d-1");
    for (const id of ["\u0000", "10\u000009", "", "a/b", "x".repeat(65), "1009 "]) {
      expect(() => wellFormedId(id), JSON.stringify(id)).toThrow(expect.objectContaining({ status: 404, code: "NOT_FOUND" }));
    }
  });

  it("names the failing field", () => {
    expect(() => parseOrThrow(schema, { adults: 0 })).toThrow(/adults/);
    expect(() => parseOrThrow(schema, null)).toThrow(AppError);
  });
});

describe("requireUser()", () => {
  it("is 401 without a session, including forged cookies", async () => {
    await expect(requireUser(req())).rejects.toMatchObject({ status: 401 });
    await expect(requireUser(req({ headers: { cookie: "better-auth.session_token=forged.value" } }))).rejects.toMatchObject({ status: 401 });
  });
});
