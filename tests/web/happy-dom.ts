import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup } from "@testing-library/react";

// Registered here rather than in each test file: ESM hoists imports, so a
// `GlobalRegistrator.register()` inside a test file would run *after* React had
// already been imported against a DOM-less global.
GlobalRegistrator.register({ url: "http://127.0.0.1:4317/" });

// Testing Library's auto-cleanup keys off a global afterEach that bun:test does
// not install for it. Unmounting between tests keeps one test's drawer from
// being found by the next one's query.
afterEach(cleanup);
