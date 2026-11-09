/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Meter } from "./charts/Meter";
import { TimeSeriesCard } from "./charts/TimeSeriesCard";
import { TimeSeriesChart } from "./charts/TimeSeriesChart";
import { TabNav } from "./layout/TabNav";
import { SegmentedControl } from "./ui/SegmentedControl";
import { StatusBadge } from "./ui/StatusBadge";
import { UnderConstruction } from "./ui/UnderConstruction";

vi.mock("next/navigation", () => ({ usePathname: () => "/annotation" }));

const t = [0, 1, 2, 3];
const one = [{ id: "lum", label: "Luminance", color: "var(--series-1)", values: [10, 20, null, 40] }];
const two = [
  { id: "l", label: "Left hand", color: "var(--series-1)", values: [0, 50, 100, 50] },
  { id: "r", label: "Right hand", color: "var(--series-2)", values: [100, 50, 0, 50] },
];

describe("TimeSeriesChart", () => {
  it("draws one path per series, no legend for a single series", () => {
    const { container } = render(<TimeSeriesChart label="Luminance" t={t} series={one} formatValue={String} />);
    expect(container.querySelectorAll("path[d^='M']").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByLabelText("Legend")).toBeNull();
  });

  it("shows a legend for two series", () => {
    render(<TimeSeriesChart label="Hands" t={t} series={two} formatValue={String} />);
    const legend = screen.getByLabelText("Legend");
    expect(within(legend).getByText("Left hand")).toBeTruthy();
    expect(within(legend).getByText("Right hand")).toBeTruthy();
  });

  it("reads values with the keyboard and seeks on Enter", async () => {
    const onSelect = vi.fn();
    render(<TimeSeriesChart label="Hands" t={t} series={two} formatValue={(v) => `${v}%`} onSelectTime={onSelect} />);
    const plot = screen.getByRole("group", { name: /Hands/ });
    plot.focus();                                   // focus selects the last point
    fireEvent.keyDown(plot, { key: "Home" });
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    expect(screen.getByText(/0:01: Left hand 50%, Right hand 50%/)).toBeTruthy(); // live region
    fireEvent.keyDown(plot, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("renders without data", () => {
    render(<TimeSeriesChart label="Empty" t={[]} series={[{ ...one[0]!, values: [] }]} formatValue={String} />);
    expect(screen.getByRole("group", { name: /Empty/ })).toBeTruthy();
  });
});

describe("TimeSeriesCard", () => {
  it("toggles to a table twin with every value", async () => {
    render(<TimeSeriesCard title="Luminance" t={t} series={one} formatValue={(v) => v.toFixed(1)} />);
    await userEvent.click(screen.getByRole("button", { name: "Table" }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(5); // header + 4
    expect(within(table).getByText("40.0")).toBeTruthy();
    expect(within(table).getByText("—")).toBeTruthy();       // the gap
    await userEvent.click(screen.getByRole("button", { name: "Chart" }));
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("small components", () => {
  it("Meter clamps and announces its value", () => {
    render(<Meter label="HOI" value={162} />);
    const meter = screen.getByRole("meter", { name: "HOI" });
    expect(meter.getAttribute("aria-valuenow")).toBe("100");
    render(<Meter label="Unknown" value={null} />);
    expect(screen.getByRole("meter", { name: "Unknown" }).getAttribute("aria-valuetext")).toBe("—");
  });

  it("StatusBadge carries text, not just colour", () => {
    render(<StatusBadge status="critical">3 decode errors</StatusBadge>);
    expect(screen.getByText("3 decode errors")).toBeTruthy();
  });

  it("SegmentedControl reports changes", async () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Source" value="a" onChange={onChange} options={[{ value: "a", label: "Upload" }, { value: "b", label: "Link" }]} />);
    await userEvent.click(screen.getByLabelText("Link"));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("TabNav marks the current tab", () => {
    render(<TabNav />);
    expect(screen.getByRole("link", { name: "Annotation" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "QC" }).getAttribute("aria-current")).toBeNull();
  });

  it("UnderConstruction shows the placeholder", () => {
    render(<UnderConstruction title="Visualisations" />);
    expect(screen.getByText("Under working")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Visualisations" })).toBeTruthy();
  });
});
