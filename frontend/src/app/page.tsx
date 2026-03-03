"use client";

import { useEffect, useState, useCallback } from "react";

// ── types ────────────────────────────────────────────────────────────────────
interface StressReading {
  zone_id: string;
  timestamp: string;
  stress_score: number;
  risk_category: "Red" | "Amber" | "Green";
  primary_driver: string;
  inputs: Record<string, number>;
}

interface ForecastPoint {
  horizon_hr: number;
  stress_score: number;
  stress_lower: number;
  stress_upper: number;
}

interface Action {
  sequence: number;
  zone_id: string;
  action_type: string;
  reduction_pct: number;
  freed_mw: number;
  projected_stress: number;
}

// ── helpers ──────────────────────────────────────────────────────────────────
const RISK_COLOURS: Record<string, string> = {
  Red: "bg-red-100 border-red-400 text-red-800",
  Amber: "bg-amber-100 border-amber-400 text-amber-800",
  Green: "bg-green-100 border-green-400 text-green-800",
};

const RISK_BADGE: Record<string, string> = {
  Red: "bg-red-500",
  Amber: "bg-amber-400",
  Green: "bg-green-500",
};

function fmt(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── component ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [readings, setReadings] = useState<StressReading[]>([]);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [triggering, setTriggering] = useState(false);

  const fetchReadings = useCallback(async () => {
    try {
      const res = await fetch("/api/stress/latest");
      if (!res.ok) {
        setError("Failed to fetch latest readings.");
        return;
      }
      const data = await res.json();
      const sorted: StressReading[] = (data.readings ?? []).sort(
        (a: StressReading, b: StressReading) => b.stress_score - a.stress_score
      );
      setReadings(sorted);
      setLastUpdated(new Date().toLocaleTimeString());
      setError("");
    } catch {
      setError("Failed to fetch latest readings.");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchZoneDetails = useCallback(async (zone_id: string) => {
    const [fRes, aRes] = await Promise.all([
      fetch(`/api/forecast?zone_id=${zone_id}`),
      fetch(`/api/actions?zone_id=${zone_id}`),
    ]);
    if (fRes.ok) {
      const fd = await fRes.json();
      setForecast(fd.forecast ?? []);
    }
    if (aRes.ok) {
      const ad = await aRes.json();
      setActions(ad.actions ?? []);
    }
  }, []);

  const triggerInfer = async () => {
    setTriggering(true);
    await fetch("/api/infer", { method: "POST" });
    await fetchReadings();
    setTriggering(false);
  };

  const selectZone = (zone_id: string) => {
    setSelectedZone(zone_id);
    setForecast([]);
    setActions([]);
    fetchZoneDetails(zone_id);
  };

  useEffect(() => {
    fetchReadings();
    const id = setInterval(fetchReadings, 60_000);
    return () => clearInterval(id);
  }, [fetchReadings]);

  useEffect(() => {
    if (selectedZone) fetchZoneDetails(selectedZone);
  }, [selectedZone, fetchZoneDetails]);

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6 font-sans">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">⚡ GridStress Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">
            Real-time grid stress predictions · Last updated: {lastUpdated || "—"}
          </p>
        </div>
        <button
          onClick={triggerInfer}
          disabled={triggering}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          {triggering ? "Running…" : "▶ Run Inference Now"}
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400">Loading data from CosmosDB…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-3">
            <h2 className="text-sm uppercase tracking-widest text-gray-500 mb-2">Zones</h2>
            {readings.length === 0 && (
              <p className="text-gray-500 text-sm">
                No readings yet — click &quot;Run Inference Now&quot; to start.
              </p>
            )}
            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}
            {readings.map((r) => (
              <button
                key={r.zone_id}
                onClick={() => selectZone(r.zone_id)}
                className={`w-full text-left border rounded-xl px-4 py-3 transition ${RISK_COLOURS[r.risk_category]} ${
                  selectedZone === r.zone_id ? "ring-2 ring-white/40" : "opacity-90 hover:opacity-100"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold capitalize">{r.zone_id.replace("-", " ")}</span>
                  <span className={`text-xs text-white font-bold px-2 py-0.5 rounded-full ${RISK_BADGE[r.risk_category]}`}>
                    {r.risk_category}
                  </span>
                </div>
                <div className="mt-2 flex items-end gap-3">
                  <span className="text-3xl font-bold">
                    {r.stress_score.toFixed(1)}<span className="text-base font-normal">%</span>
                  </span>
                  <span className="text-xs mb-1">Driver: <strong>{r.primary_driver}</strong></span>
                </div>
                <div className="text-xs mt-1 opacity-70">{fmt(r.timestamp)}</div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-2 space-y-6">
            {!selectedZone ? (
              <div className="bg-gray-900 rounded-xl p-6 text-gray-500 text-sm">
                Select a zone to view its 24-hr forecast and load reduction actions.
              </div>
            ) : (
              <>
                <div className="bg-gray-900 rounded-xl p-5">
                  <h2 className="font-semibold mb-4 text-gray-200">
                    24-hr Forecast — <span className="capitalize">{selectedZone.replace("-", " ")}</span>
                  </h2>
                  {forecast.length === 0 ? (
                    <p className="text-gray-500 text-sm">Loading forecast…</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 border-b border-gray-800">
                            <th className="text-left py-2 pr-4">Hour+</th>
                            <th className="text-right pr-4">Lower</th>
                            <th className="text-right pr-4">Median</th>
                            <th className="text-right">Upper</th>
                          </tr>
                        </thead>
                        <tbody>
                          {forecast.map((f) => (
                            <tr key={f.horizon_hr} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                              <td className="py-1.5 pr-4 text-gray-400">+{f.horizon_hr}h</td>
                              <td className="text-right pr-4 text-blue-300">{f.stress_lower.toFixed(1)}%</td>
                              <td className={`text-right pr-4 font-semibold ${
                                f.stress_score >= 70 ? "text-red-400" : f.stress_score >= 40 ? "text-amber-400" : "text-green-400"
                              }`}>{f.stress_score.toFixed(1)}%</td>
                              <td className="text-right text-blue-300">{f.stress_upper.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="bg-gray-900 rounded-xl p-5">
                  <h2 className="font-semibold mb-4 text-gray-200">Load Reduction Actions</h2>
                  {actions.length === 0 ? (
                    <p className="text-gray-500 text-sm">No actions — zone is Green or data pending.</p>
                  ) : (
                    <div className="space-y-2">
                      {actions.map((a) => (
                        <div key={a.sequence} className="flex items-center gap-4 bg-gray-800 rounded-lg px-4 py-3 text-sm">
                          <span className="text-gray-500 font-mono w-5">#{a.sequence}</span>
                          <span className="capitalize flex-1">{a.zone_id.replace("-", " ")}</span>
                          <span className="text-amber-300">−{a.reduction_pct}%</span>
                          <span className="text-green-300">{a.freed_mw} MW freed</span>
                          <span className="text-gray-400">→ {a.projected_stress.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}


