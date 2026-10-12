import { test as base, expect } from "@playwright/test";

/** Pre-accepts cookies so the banner doesn't cover the page, except in tests about the banner. */
export const test = base.extend<{ consent: boolean }>({
  consent: [true, { option: true }],
  page: async ({ page, context, baseURL, consent }, run) => {
    if (consent) await context.addCookies([{ name: "nidou_consent", value: "all", url: baseURL! }]);
    await run(page);
  },
});

export { expect };
