/** Global test setup: deterministic timezone and DOM cleanup for component tests. */
import { afterEach } from "vitest";

process.env.TZ = "UTC";

afterEach(async () => {
  if (typeof document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
