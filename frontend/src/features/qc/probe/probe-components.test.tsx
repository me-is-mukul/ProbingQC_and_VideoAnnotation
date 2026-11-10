/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";

import { probeFramesCsv, probeResults } from "../../../../tests/fixtures/probe";
import { ResultsDashboard } from "../results/ResultsDashboard";
import { LineControls } from "./components/LineControls";
import { ProbeTimeline } from "./components/ProbeTimeline";

const JOB = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const series = [{ id: "lum", label: "Luminance", color: "var(--series-1)", values: [10, 200, 30, 100] }];

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn(); // not implemented by jsdom
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chart threshold line", () => {
  it("starts unset on the edge that selects nothing and moves with the keyboard", async () => {
    const onChange = vi.fn();
    render(
      <TimeSeriesChart label="Luminance" t={[0, 1, 2, 3]} series={series} formatValue={(v) => v.toFixed(1)} yDomain={[0, 200]}
        threshold={{ value: null, direction: "below", label: "Probe line for Luminance", onChange }} />,
    );
    const handle = screen.getByRole("slider", { name: "Probe line for Luminance" });
    expect(handle.getAttribute("aria-valuenow")).toBe("0");            // bottom edge: nothing is below it
    expect(handle.getAttribute("aria-valuetext")).toMatch(/Not set/);
    expect(handle.textContent).toContain("Probe");
    handle.focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith(2);                     // 1 % of the range
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(onChange).toHaveBeenLastCalledWith(20);                    // 10 %
    await userEvent.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith(200);
  });

  it("an unset 'above' line sits at the top; a set line shows its value and shades its region", () => {
    const { rerender, container } = render(
      <TimeSeriesChart label="L" t={[0, 1]} series={series.map((s) => ({ ...s, values: [1, 2] }))} formatValue={(v) => v.toFixed(1)} yDomain={[0, 10]}
        threshold={{ value: null, direction: "above", label: "line", onChange: () => {} }} />,
    );
    expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("10");
    rerender(
      <TimeSeriesChart label="L" t={[0, 1]} series={series.map((s) => ({ ...s, values: [1, 2] }))} formatValue={(v) => v.toFixed(1)} yDomain={[0, 10]}
        threshold={{ value: 4, direction: "below", label: "line", onChange: () => {} }} bands={[[0.2, 0.6]]} />,
    );
    expect(screen.getByRole("slider").textContent).toContain("< 4.0");
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe("Selects frames below 4.0");
    expect(container.querySelectorAll("rect[class*='zone']")).toHaveLength(1);
    expect(container.querySelectorAll("rect[class*='band']").length).toBe(2); // wash + mark
  });

  it("ignores keys while disabled", async () => {
    const onChange = vi.fn();
    render(<TimeSeriesChart label="L" t={[0, 1]} series={series} formatValue={String} yDomain={[0, 10]}
      threshold={{ value: null, direction: "below", label: "line", onChange, disabled: true }} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowUp" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("line controls", () => {
  it("switches direction and offers reset only for a set line", async () => {
    const onDirection = vi.fn();
    const onReset = vi.fn();
    const { rerender } = render(<LineControls chartTitle="Sharpness" direction="below" active={false} onDirection={onDirection} onReset={onReset} />);
    expect(screen.getByRole("button", { name: "Below" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Above" }));
    expect(onDirection).toHaveBeenCalledWith("above");
    rerender(<LineControls chartTitle="Sharpness" direction="above" active onDirection={onDirection} onReset={onReset} />);
    await userEvent.click(screen.getByRole("button", { name: "Reset the Sharpness probe line" }));
    expect(onReset).toHaveBeenCalled();
  });
});

describe("probe timeline", () => {
  it("describes what is removed and seeks on click", () => {
    const onSeek = vi.fn();
    render(<ProbeTimeline label="Timeline: removes 1 s" duration={10} removed={[[2, 3]]} extra={[[3, 3.5]]} analysed={[0, 8]} onSeek={onSeek} />);
    expect(screen.getByRole("img", { name: "Timeline: removes 1 s" })).toBeTruthy();
    const legend = screen.getByRole("list", { name: "Timeline legend" });
    expect(within(legend).getByText("Removed by the command")).toBeTruthy();
    expect(within(legend).getByText("Also removed to start on a keyframe")).toBeTruthy();
    expect(within(legend).getByText("Not analysed (always kept)")).toBeTruthy();
  });
});

describe("probing on the results page", () => {
  function stubFetch() {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/frames")) return new Response(probeFramesCsv(), { headers: { "Content-Type": "text/csv" } });
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("moving lines updates the timeline, the section figures and the command", async () => {
    const fetchMock = stubFetch();
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<ResultsDashboard results={probeResults()} jobId={JOB} currentTime={null} onSeek={() => {}} onNewAnalysis={() => {}} />);
    expect(fetchMock).toHaveBeenCalledWith(`/api/jobs/${JOB}/frames`, expect.anything());

    // 4 image + 4 hand charts carry a line; the IMU charts don't.
    await waitFor(() => expect(screen.getAllByRole("slider").every((s) => s.getAttribute("aria-disabled") !== "true")).toBe(true));
    expect(screen.getAllByRole("slider")).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Get probing command" })).toHaveProperty("disabled", true);

    // Luminance (0-255): PageUp twice -> 51; points 15 and 35 are below -> frames [0, 16) are removed.
    const lum = screen.getByRole("slider", { name: "Probe line for Luminance" });
    lum.focus();
    await userEvent.keyboard("{PageUp}{PageUp}");
    expect(lum.getAttribute("aria-valuetext")).toMatch(/below 51\.0/);

    const panel = screen.getByRole("region", { name: "Probing" });
    await waitFor(() => expect(within(panel).getByText("40.0% of the video")).toBeTruthy());
    expect(within(panel).getByRole("list", { name: "Lines set" }).textContent).toContain("Luminance < 51.0");
    expect(screen.getAllByText(/Figures below are for the kept part/).length).toBeGreaterThan(0);

    await userEvent.click(within(panel).getByRole("button", { name: "Get probing command" }));
    const code = within(panel).getByLabelText("ffmpeg command");
    expect(code.textContent).toMatch(/^ffmpeg -i "GX010191\.MP4" -filter_complex "\[0:v:0\]split=1\[v0\];/);
    expect(code.textContent).toContain("trim=start_frame=16");
    await userEvent.click(within(panel).getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(code.textContent);

    // Fast mode: [16, 40) starts on keyframe 20 -> a concat list to save next to the video.
    await userEvent.click(within(panel).getByLabelText("Fast · lossless"));
    expect(within(panel).getByLabelText("ffmpeg command").textContent).toContain("-f concat -safe 0");
    expect(within(panel).getByRole("button", { name: "Download GX010191_probe.ffconcat" })).toBeTruthy();
    expect(within(panel).getByText("Also removed to start on a keyframe")).toBeTruthy();

    // Reset brings everything back to "nothing removed".
    await userEvent.click(within(panel).getByRole("button", { name: "Reset all lines" }));
    await waitFor(() => expect(within(panel).getByText("0.0% of the video")).toBeTruthy());
    expect(screen.queryByText(/Figures below are for the kept part/)).toBeNull();
  });

  it("explains when the frame table can't be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "not_found", message: "Frame table not found" } }, { status: 404 })));
    render(<ResultsDashboard results={probeResults()} jobId={JOB} currentTime={null} onSeek={() => {}} onNewAnalysis={() => {}} />);
    expect(await screen.findByText(/Probing is unavailable: Frame table not found/)).toBeTruthy();
    expect(screen.getAllByRole("slider").every((s) => s.getAttribute("aria-disabled") === "true")).toBe(true);
  });

  it("disables fast cuts for results without a keyframe index", async () => {
    stubFetch();
    render(<ResultsDashboard results={probeResults({ keyframes: undefined })} jobId={JOB} currentTime={null} onSeek={() => {}} onNewAnalysis={() => {}} />);
    const panel = screen.getByRole("region", { name: "Probing" });
    await waitFor(() => expect(within(panel).getByLabelText("Fast · lossless")).toHaveProperty("disabled", true));
    expect(within(panel).getByText(/predate the keyframe index/)).toBeTruthy();
  });
});
