/** The access-codes key of the test suites (seed, integration, e2e server). Public: test databases only. */
export const TEST_ACCESS_CODES_KEY = Buffer.alloc(32, 7).toString("base64");
/** The identity documents' key of the test suites (Lot 5). Public: test databases only. */
export const TEST_IDENTITY_DOCS_KEY = Buffer.alloc(32, 9).toString("base64");
