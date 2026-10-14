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

/**
 * yyyy-MM-dd `base + n` days from today, shifted per repetition and retry so a test that books fixed
 * listings never collides with its own earlier attempt in the same database.
 */
export function stayDays(testInfo: { repeatEachIndex: number; retry: number }, base: number) {
  const shift = (testInfo.repeatEachIndex * 2 + testInfo.retry) * 5;
  return (n: number) => new Date(Date.now() + (base + shift + n) * 86_400_000).toISOString().slice(0, 10);
}
