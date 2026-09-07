import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { RoutePoint } from "@shared/types";

interface ElevationProfileProps {
  points: RoutePoint[];
}

export function ElevationProfile({ points }: ElevationProfileProps) {
  if (points.length === 0) return null;

  const data = points.map((p) => ({
    km: p.distanceFromStart / 1000,
    ele: p.ele,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="km"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(v: number) => v.toFixed(0)}
          label={{ value: "км", position: "insideBottomRight", offset: -5 }}
        />
        <YAxis
          dataKey="ele"
          domain={["dataMin - 10", "dataMax + 10"]}
          label={{ value: "м", angle: -90, position: "insideLeft" }}
        />
        <Tooltip
          formatter={(value) => [`${Number(value).toFixed(0)} м`, "Высота"]}
          labelFormatter={(v) => `${Number(v).toFixed(1)} км`}
        />
        <Area
          type="monotone"
          dataKey="ele"
          stroke="#8884d8"
          fill="#8884d8"
          fillOpacity={0.4}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
