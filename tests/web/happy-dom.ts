import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Registered here rather than in each test file: ESM hoists imports, so a
// `GlobalRegistrator.register()` inside a test file would run *after* React had
// already been imported against a DOM-less global.
GlobalRegistrator.register({ url: "http://127.0.0.1:4317/" });

// Imported dynamically for that same reason, one level deeper: Testing
// Library's `screen` binds its queries to `document.body` at module-evaluation
// time and throws for the rest of the run if `document` was missing then. A
// static import here would be hoisted above the registration and break every
// `screen` query in every web test.
const { cleanup } = await import("@testing-library/react");

// Testing Library's auto-cleanup keys off a global afterEach that bun:test does
// not install for it. Unmounting between tests keeps one test's panel from
// being found by the next one's query.
afterEach(cleanup);
