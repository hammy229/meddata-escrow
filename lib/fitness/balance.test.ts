import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkGroupBalance,
  SMD_NOISE_Z,
  smdBinary,
  smdNumeric,
  smdStdError,
} from "./balance";

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe("smdNumeric", () => {
  // A = [1, 2, 3]: mean 2, sample variance 1. B = [3, 4, 5]: mean 4, variance 1.
  // SMD = (4 - 2) / sqrt((1 + 1) / 2) = 2.
  it("matches a hand calculation", () => {
    assert.ok(near(smdNumeric([1, 2, 3], [3, 4, 5]), 2));
    assert.ok(near(smdNumeric([3, 4, 5], [1, 2, 3]), -2));
  });

  // A = [0, 2]: mean 1, variance 2. B = [2, 6]: mean 4, variance 8.
  // SMD = 3 / sqrt((2 + 8) / 2) = 3 / sqrt(5) = 1.3416
  it("uses the average of the two variances", () => {
    assert.ok(near(smdNumeric([0, 2], [2, 6]), 3 / Math.sqrt(5)));
  });

  it("is 0 for constant or empty input", () => {
    assert.equal(smdNumeric([4, 4], [4, 4]), 0);
    assert.equal(smdNumeric([], [1, 2]), 0);
  });
});

describe("smdBinary", () => {
  // pA = 0.5, pB = 0.25. SMD = -0.25 / sqrt((0.25 + 0.1875) / 2) = -0.25 / 0.46771 = -0.5345
  it("matches a hand calculation", () => {
    assert.ok(
      near(smdBinary([1, 0, 1, 0], [1, 0, 0, 0]), -0.25 / Math.sqrt(0.21875)),
    );
  });

  it("is 0 when both groups are all one value", () => {
    assert.equal(smdBinary([1, 1], [1, 1]), 0);
    assert.equal(smdBinary([], [1]), 0);
  });
});

describe("checkGroupBalance", () => {
  // Group A holds [-1, 0, 1] (mean 0, variance 1); group B shifts it by d, so SMD = d.
  const rowsFor = (d: number) => [
    ...[-1, 0, 1].map((x) => ({ g: "A", x })),
    ...[-1, 0, 1].map((x) => ({ g: "B", x: x + d })),
  ];

  it("warns from 0.1 and fails from 0.25", () => {
    assert.equal(
      checkGroupBalance(rowsFor(0.0999), "g", ["x"])[0].severity,
      "pass",
    );
    assert.equal(
      checkGroupBalance(rowsFor(0.1001), "g", ["x"])[0].severity,
      "warn",
    );
    assert.equal(
      checkGroupBalance(rowsFor(0.2499), "g", ["x"])[0].severity,
      "warn",
    );
    assert.equal(
      checkGroupBalance(rowsFor(0.2501), "g", ["x"])[0].severity,
      "fail",
    );
    assert.equal(
      checkGroupBalance(rowsFor(-0.5), "g", ["x"])[0].severity,
      "fail",
    );
  });

  it("with the noise gate, ignores a chance-sized gap in a small sample but keeps a big one", () => {
    // Six subjects per group: SMD 0.3 is well inside sampling noise.
    const rows = (d: number) => [
      ...[-1, 0, 1, -1, 0, 1].map((x) => ({ g: "A", x })),
      ...[-1, 0, 1, -1, 0, 1].map((x) => ({ g: "B", x: x + d })),
    ];
    assert.equal(checkGroupBalance(rows(0.3), "g", ["x"])[0].severity, "fail");
    const gated = checkGroupBalance(rows(0.3), "g", ["x"], {
      noiseZ: SMD_NOISE_Z,
    });
    assert.deepEqual(
      gated.map((f) => f.severity),
      ["pass"],
    );
    assert.equal(
      checkGroupBalance(rows(3), "g", ["x"], { noiseZ: SMD_NOISE_Z })[0]
        .severity,
      "fail",
    );
  });

  it("with the noise gate, the same SMD counts once the sample is large", () => {
    const big = (d: number) => [
      ...Array.from({ length: 500 }, (_, i) => ({ g: "A", x: (i % 3) - 1 })),
      ...Array.from({ length: 500 }, (_, i) => ({
        g: "B",
        x: (i % 3) - 1 + d,
      })),
    ];
    const f = checkGroupBalance(big(0.3), "g", ["x"], { noiseZ: SMD_NOISE_Z });
    assert.equal(f[0].severity, "fail");
  });

  it("standard error of an SMD shrinks with sample size", () => {
    assert.ok(smdStdError(0, 50, 50) > smdStdError(0, 500, 500));
    assert.ok(Math.abs(smdStdError(0, 50, 50) - 0.2) < 1e-9);
  });

  it("treats 0/1 columns as binary", () => {
    const rows = [
      ...[1, 0, 1, 0].map((x) => ({ g: "A", x })),
      ...[1, 0, 0, 0].map((x) => ({ g: "B", x })),
    ];
    const f = checkGroupBalance(rows, "g", ["x"])[0];
    assert.equal(f.severity, "fail");
    assert.equal(f.metric?.smd, 0.535);
  });

  it("splits text columns into levels and keeps the worst", () => {
    const rows = [
      ...["F", "F", "F", "M"].map((x) => ({ g: "A", x })),
      ...["F", "M", "M", "M"].map((x) => ({ g: "B", x })),
    ];
    assert.equal(checkGroupBalance(rows, "g", ["x"])[0].severity, "fail");
  });

  it("hides small group sizes", () => {
    const f = checkGroupBalance(rowsFor(1), "g", ["x"])[0];
    assert.equal(f.metric?.groupA, "fewer than 11");
  });

  it("is informational unless there are exactly two groups", () => {
    assert.equal(
      checkGroupBalance([{ g: "A", x: 1 }], "g", ["x"])[0].severity,
      "info",
    );
    assert.equal(checkGroupBalance([], "g", ["x"])[0].severity, "info");
    const three = ["A", "B", "C"].map((g) => ({ g, x: 1 }));
    assert.equal(checkGroupBalance(three, "g", ["x"])[0].severity, "info");
  });

  it("skips the group column and all-missing features", () => {
    const rows = [
      { g: "A", x: null },
      { g: "B", x: null },
    ];
    assert.equal(checkGroupBalance(rows, "g", ["g", "x"])[0].severity, "pass");
  });
});
