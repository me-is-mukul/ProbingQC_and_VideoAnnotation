/** @vitest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { legacyHandMetrics, makeResults } from "../../../tests/fixtures/results";
import { PipelineTerminal } from "./components/PipelineTerminal";
import { SourceForm } from "./components/SourceForm";
import { StageTracker } from "./components/StageTracker";
import { ResultsDashboard } from "./results/ResultsDashboard";
import { initialSession } from "./state/session";
import type { TerminalLine } from "./state/terminal";

const line = (id: number, text: string, extra: Partial<TerminalLine> = {}): TerminalLine => ({ id, t: 0, tone: "default", tag: "qc", text, ...extra });

describe("PipelineTerminal", () => {
  it("shows pipeline lines and hides native stderr until asked", async () => {
    render(<PipelineTerminal live lines={[line(1, "▸ Reading metadata"), line(2, "W0000 mediapipe chatter", { tone: "muted", tag: "stderr" })]} />);
    const log = screen.getByRole("log");
    expect(within(log).getByText("▸ Reading metadata")).toBeTruthy();
    expect(within(log).queryByText("W0000 mediapipe chatter")).toBeNull();
    await userEvent.click(screen.getByLabelText("Native output"));
    expect(within(log).getByText("W0000 mediapipe chatter")).toBeTruthy();
  });
});

describe("StageTracker", () => {
  it("labels each step with its status and describes the active one", () => {
    const stages = {
      ...initialSession.stages,
      download: { status: "done" as const, message: "Uploaded 2 MB", progress: 1 },
      probe: { status: "active" as const, message: "Reading container metadata", progress: null },
    };
    render(<StageTracker stages={stages} sourceLabel="Upload" />);
    expect(screen.getByText(": Done")).toBeTruthy();
    expect(screen.getByText(": In progress")).toBeTruthy();
    expect(screen.getByText("Metadata.")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Metadata progress" })).toBeTruthy();
  });
});

describe("SourceForm", () => {
  it("enables Start only once a video is chosen, and passes options", async () => {
    const onStart = vi.fn();
    const { container } = render(<SourceForm onStart={onStart} />);
    const start = screen.getByRole("button", { name: "Start analysis" });
    expect((start as HTMLButtonElement).disabled).toBe(true);

    const file = new File(["x"], "GX010140.MP4", { type: "video/mp4" });
    await userEvent.upload(container.querySelector("input[type=file]") as HTMLInputElement, file);
    expect(screen.getByText("GX010140.MP4")).toBeTruthy();

    await userEvent.click(screen.getByText("Processing options"));
    await userEvent.click(screen.getByRole("button", { name: "First minute" }));
    await userEvent.click(start);
    expect(onStart).toHaveBeenCalledWith({ kind: "file", file }, { hands: true, imu: true, maxSeconds: 60 });
  });

  it("validates links before starting", async () => {
    const onStart = vi.fn();
    render(<SourceForm onStart={onStart} />);
    await userEvent.click(screen.getByLabelText("Link"));
    await userEvent.type(screen.getByLabelText("Video link"), "ftp://x.org/v.mp4");
    await userEvent.click(screen.getByRole("button", { name: "Start analysis" }));
    expect(screen.getByRole("alert").textContent).toMatch(/http/);
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe("ResultsDashboard", () => {
  it("renders every section for a full result", () => {
    render(<ResultsDashboard results={makeResults()} jobId={null} currentTime={null} onSeek={() => {}} onNewAnalysis={() => {}} />);
    for (const name of ["Overview", "Image quality", "Hands", "Motion"]) {
      expect(screen.getByRole("heading", { name, level: 2 })).toBeTruthy();
    }
    expect(screen.getByText("No decode errors")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Table" }).length).toBeGreaterThanOrEqual(8);
  });

  it("groups the hand figures into tracking and interaction", () => {
    render(<ResultsDashboard results={makeResults()} jobId={null} currentTime={null} onSeek={() => {}} onNewAnalysis={() => {}} />);
    expect(screen.getByRole("heading", { name: "Tracking", level: 3 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Hand-object interaction", level: 3 })).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Two-handed contact" })).toBeTruthy();
    expect(screen.getByText("Dominant hand")).toBeTruthy();
    expect(screen.queryByText("Left and right are swapped in this report")).toBeNull();
  });

  it("warns that left and right are swapped in reports made before schema 1.2", () => {
    const r = makeResults();
    const report = { ...r.report, schema_version: "1.1", hands: legacyHandMetrics() };
    render(<ResultsDashboard results={{ ...r, report }} jobId={null} currentTime={null} onSeek={() => {}} onNewAnalysis={() => {}} />);
    expect(screen.getByRole("note", { name: "Left and right are swapped in this report" }).textContent).toMatch(/Run the video again/);
    expect(screen.queryByRole("meter", { name: "Two-handed contact" })).toBeNull(); // no HOI block before 1.2
  });

  it("omits Hands and Motion when they were not computed", () => {
    const r = makeResults({ imu: null });
    const report = { ...r.report, hands: undefined };
    render(<ResultsDashboard results={{ ...r, report }} jobId={null} currentTime={null} onSeek={() => {}} onNewAnalysis={() => {}} />);
    expect(screen.queryByRole("heading", { name: "Hands" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Motion" })).toBeNull();
  });
});
