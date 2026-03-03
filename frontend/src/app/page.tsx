"use client";

import { useEffect, useState, useCallback } from "react";
import toast, { Toaster } from "react-hot-toast";

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

// ── hex grid layout ──────────────────────────────────────────────────────────
const HEX_POSITIONS: Record<string, [number, number]> = {
  "zone-north":   [1, 0],
  "zone-west":    [0, 1],
  "zone-central": [1, 1],
  "zone-east":    [2, 1],
  "zone-south":   [1, 2],
};

function getFallbackPositions(usedPositions: [number, number][], count: number): [number, number][] {
  const used = new Set(usedPositions.map(([c, r]) => `${c},${r}`));
  const result: [number, number][] = [];
  for (let row = 0; row < 5 && result.length < count; row++) {
    for (let col = 0; col < 5 && result.length < count; col++) {
      if (!used.has(`${col},${row}`)) {
        result.push([col, row]);
        used.add(`${col},${row}`);
      }
    }
  }
  return result;
}

function hexCenter(col: number, row: number, size: number, offsetX = 125, offsetY = -10): [number, number] {
  const w = size * 2;
  const h = Math.sqrt(3) * size;
  const x = col * w * 0.75 + size + offsetX;
  const y = row * h + (col % 2 === 0 ? 0 : h / 2) + h / 2 + offsetY;
  return [x, y];
}

function hexPoints(cx: number, cy: number, size: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i);
    return `${(cx + size * Math.cos(angle)).toFixed(2)},${(cy + size * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

// ── helpers ──────────────────────────────────────────────────────────────────
function getRiskColor(risk: string): string {
  if (risk === "Red") return "#ff3b3b";
  if (risk === "Amber") return "#f0a500";
  return "#00e676";
}

function fmt(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Hex Heatmap ──────────────────────────────────────────────────────────────
function HexHeatmap({
  readings,
  selectedZone,
  onSelect,
}: {
  readings: StressReading[];
  selectedZone: string | null;
  onSelect: (id: string) => void;
}) {
  const SIZE = 50;
  const SVG_W = 500;
  const SVG_H = 340;

  const knownIds = Object.keys(HEX_POSITIONS);
  const unknownReadings = readings.filter(r => !knownIds.includes(r.zone_id));
  const usedPositions = Object.values(HEX_POSITIONS);
  const fallbacks = getFallbackPositions(usedPositions, unknownReadings.length);
  let fi = 0;

  const positioned = readings.map((r) => {
    const pos = knownIds.includes(r.zone_id)
      ? HEX_POSITIONS[r.zone_id]
      : fallbacks[fi++] ?? [0, 0];
    const [cx, cy] = hexCenter(pos[0], pos[1], SIZE);
    return { ...r, cx, cy };
  });

  const bgHexes: [number, number][] = [
    [0,0],[1,0],[2,0],
    [0,1],[1,1],[2,1],
    [0,2],[1,2],[2,2],
  ];

  return (
    <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ width: "100%", height: "100%", display: "block" }}>
      {Array.from({ length: 9 }, (_, row) =>
        Array.from({ length: 13 }, (_, col) => (
          <circle key={`d${col}-${row}`} cx={col * 40 + 4} cy={row * 42 + 4} r="0.7" fill="#1e2d3d" />
        ))
      )}

      {bgHexes.map(([col, row]) => {
        const [cx, cy] = hexCenter(col, row, SIZE);
        return (
          <polygon key={`bg${col}${row}`}
            points={hexPoints(cx, cy, SIZE - 2)}
            fill="none" stroke="#1e2d3d" strokeWidth="1" opacity="0.5"
          />
        );
      })}

      {positioned.map((r) => {
        const color = getRiskColor(r.risk_category);
        const sel = selectedZone === r.zone_id;
        const label = r.zone_id.replace("zone-", "").toUpperCase();
        const fillPct = (SIZE - 8) * (r.stress_score / 100);

        return (
          <g key={r.zone_id} onClick={() => onSelect(r.zone_id)} style={{ cursor: "pointer" }}>
            {sel && (
              <polygon
                points={hexPoints(r.cx, r.cy, SIZE + 5)}
                fill="none" stroke={color} strokeWidth="2" opacity="0.55"
                style={{ filter: `drop-shadow(0 0 7px ${color})` }}
              />
            )}

            <polygon
              points={hexPoints(r.cx, r.cy, SIZE - 2)}
              fill={color}
              fillOpacity={sel ? 0.3 : 0.12}
              stroke={color}
              strokeWidth={sel ? 2 : 1}
              style={{ transition: "fill-opacity 0.2s", filter: sel ? `drop-shadow(0 0 10px ${color}88)` : undefined }}
            />

            <polygon
              points={hexPoints(r.cx, r.cy, fillPct)}
              fill={color}
              fillOpacity={0.22}
            />

            <text x={r.cx} y={r.cy - 12}
              textAnchor="middle" dominantBaseline="middle"
              fill={color} fontSize="8.5"
              fontFamily="'Share Tech Mono', monospace"
              fontWeight="bold" letterSpacing="1.5">
              {label}
            </text>

            <text x={r.cx} y={r.cy + 5}
              textAnchor="middle" dominantBaseline="middle"
              fill={sel ? "#e8f4ff" : color} fontSize="14"
              fontFamily="'Barlow Condensed', sans-serif"
              fontWeight="700">
              {r.stress_score.toFixed(1)}%
            </text>

            <text x={r.cx} y={r.cy + 21}
              textAnchor="middle" dominantBaseline="middle"
              fill={color} fontSize="7"
              fontFamily="'Share Tech Mono', monospace"
              opacity="0.75">
              {r.risk_category.toUpperCase()}
            </text>
          </g>
        );
      })}

      {readings.length === 0 && (
        <text x={SVG_W / 2} y={SVG_H / 2}
          textAnchor="middle" fill="#5a7a94"
          fontSize="11" fontFamily="'Share Tech Mono', monospace">
          NO DATA — RUN INFERENCE TO POPULATE
        </text>
      )}
    </svg>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [readings, setReadings] = useState<StressReading[]>([]);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [triggering, setTriggering] = useState(false);
  const [clock, setClock] = useState("");
  const [activeTab, setActiveTab] = useState<"map" | "detail">("map");

  useEffect(() => {
    const update = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, []);

  const fetchReadings = useCallback(async () => {
    try {
      const res = await fetch("/api/stress/latest");
      if (!res.ok) { setError("Failed to fetch latest readings."); return; }
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
    if (fRes.ok) { const fd = await fRes.json(); setForecast(fd.forecast ?? []); }
    if (aRes.ok) { const ad = await aRes.json(); setActions(ad.actions ?? []); }
  }, []);

  const triggerInfer = async (simulationData?: unknown) => {
    setTriggering(true);

    const inferTask = async () => {
      const res = await fetch("/api/infer", { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(simulationData ? { input_override: simulationData } : {})
      });
      if (!res.ok) throw new Error("Inference task failed");
      await fetchReadings();
      return simulationData ? "Simulation complete" : "Inference complete. Grid updated.";
    };

    toast.promise(
      inferTask(),
      {
        loading: simulationData ? "Injecting simulation parameters..." : "Running grid inference engine...",
        success: (msg) => msg,
        error: "Failed to run inference. Check logs.",
      },
      {
        style: {
          minWidth: "250px",
          background: "var(--bg3)",
          color: "var(--textbright)",
          border: "1px solid var(--border)",
          fontFamily: "'Share Tech Mono', monospace",
          fontSize: "0.75rem",
        },
        success: {
          duration: 4000,
          iconTheme: {
            primary: "var(--green)",
            secondary: "var(--bg3)",
          },
        },
      }
    ).finally(() => setTriggering(false));
  };

  const selectZone = (zone_id: string) => {
    setSelectedZone(zone_id);
    setForecast([]);
    setActions([]);
    fetchZoneDetails(zone_id);
    setActiveTab("detail");
  };

  useEffect(() => {
    fetchReadings();
    const id = setInterval(fetchReadings, 60_000);
    return () => clearInterval(id);
  }, [fetchReadings]);

  useEffect(() => {
    if (selectedZone) fetchZoneDetails(selectedZone);
  }, [selectedZone, fetchZoneDetails]);

  const redCount = readings.filter(r => r.risk_category === "Red").length;
  const amberCount = readings.filter(r => r.risk_category === "Amber").length;
  const greenCount = readings.filter(r => r.risk_category === "Green").length;
  const avgStress = readings.length > 0
    ? (readings.reduce((a, r) => a + r.stress_score, 0) / readings.length).toFixed(1)
    : "—";

  const selectedReading = readings.find(r => r.zone_id === selectedZone);
  const rc = selectedReading ? getRiskColor(selectedReading.risk_category) : "#0af";

  const FW = 320, FH = 90, FP = 8;
  const xS = (i: number) => FP + (i / Math.max(forecast.length - 1, 1)) * (FW - FP * 2);
  const yS = (v: number) => FH - FP - (v / 100) * (FH - FP * 2);
  const linePts = forecast.map((p, i) => `${xS(i)},${yS(p.stress_score)}`).join(" ");
  const bandPts =
    forecast.map((p, i) => `${xS(i)},${yS(p.stress_upper)}`).join(" ") + " " +
    [...forecast].reverse().map((p, i) => `${xS(forecast.length - 1 - i)},${yS(p.stress_lower)}`).join(" ");

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow+Condensed:wght@400;600;700&family=Barlow:wght@300;400;500;600&display=swap');
        :root {
          --red:#ff3b3b;--amber:#f0a500;--green:#00e676;--blue:#0af;
          --bg:#080c10;--bg2:#0d1318;--bg3:#111820;--bg4:#161f28;
          --border:#1e2d3d;--border2:#243545;
          --text:#c8d8e8;--textdim:#5a7a94;--textbright:#e8f4ff;
        }
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:var(--bg);font-family:'Barlow',sans-serif;color:var(--text);}
        body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:9999;
          background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.018) 2px,rgba(0,0,0,0.018) 4px);}
        .mono{font-family:'Share Tech Mono',monospace;}
        .cond{font-family:'Barlow Condensed',sans-serif;}
        .scrollbar-thin::-webkit-scrollbar{width:3px;}
        .scrollbar-thin::-webkit-scrollbar-track{background:var(--bg3);}
        .scrollbar-thin::-webkit-scrollbar-thumb{background:var(--border2);}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.15}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
        .blink{animation:blink 1.5s infinite;}
        .fade-up{animation:fadeUp 0.2s ease;}
        .zone-row{cursor:pointer;transition:background 0.15s;}
        .zone-row:hover{background:var(--bg4)!important;}
      `}</style>

      <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

        {/* ── HEADER ── */}
        <header style={{ background: "var(--bg2)", borderBottom: "1px solid var(--border)", height: 54, position: "sticky", top: 0, zIndex: 40, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
              <polygon points="16,2 30,28 2,28" fill="none" stroke="#0af" strokeWidth="1.5" />
              <polygon points="16,8 26,26 6,26" fill="#0af" fillOpacity="0.08" />
              <circle cx="16" cy="20" r="3" fill="#0af" fillOpacity="0.9" />
              <line x1="16" y1="8" x2="16" y2="17" stroke="#0af" strokeWidth="1" strokeDasharray="2,2" />
            </svg>
            <div>
              <div className="cond" style={{ color: "#0af", fontSize: "1.3rem", fontWeight: 700, letterSpacing: "0.12em", textShadow: "0 0 8px #00aaff44", lineHeight: 1 }}>Grasp</div>
              <div className="mono" style={{ fontSize: "0.52rem", color: "var(--textdim)", letterSpacing: "0.08em" }}> GRID RISK ANALYTICS FOR STRESS & PREVENTION</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <div className="blink" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 8px #00e67688" }} />
              <span className="mono" style={{ fontSize: "0.65rem", color: "var(--green)" }}>LIVE</span>
            </div>
            <div className="mono" style={{ fontSize: "0.65rem", color: "var(--textdim)" }}>{clock}</div>
            <button onClick={() => triggerInfer()} disabled={triggering} className="cond"
              style={{ background: triggering ? "#1e3a5f" : "#1d4ed8", border: "1px solid #2563eb", color: "#fff", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.1em", padding: "0.3rem 0.85rem", borderRadius: 2, cursor: triggering ? "not-allowed" : "pointer", opacity: triggering ? 0.6 : 1 }}>
              {triggering ? "RUNNING…" : "▶ RUN INFERENCE"}
            </button>
          </div>
        </header>

        {/* ── STATUS BAR ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: "1px", background: "var(--border)", borderBottom: "1px solid var(--border)" }}>
          {[
            { label: "CRITICAL", value: String(redCount), color: "var(--red)", sub: "Red zones" },
            { label: "AMBER", value: String(amberCount), color: "var(--amber)", sub: "Monitor" },
            { label: "STABLE", value: String(greenCount), color: "var(--green)", sub: "Green zones" },
            { label: "AVG STRESS", value: avgStress + "%", color: "var(--blue)", sub: "Grid-wide" },
            { label: "TOTAL ZONES", value: String(readings.length), color: "var(--textbright)", sub: "Active" },
            { label: "LAST SYNC", value: lastUpdated || "—", color: "var(--textbright)", sub: "Auto 60s" },
          ].map((s, i) => (
            <div key={i} style={{ background: "var(--bg2)", padding: "0.55rem 0.8rem", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: s.color, boxShadow: `0 0 6px ${s.color}66` }} />
              <div className="mono" style={{ fontSize: "0.52rem", color: "var(--textdim)", letterSpacing: "0.1em", marginBottom: "0.15rem" }}>{s.label}</div>
              <div className="cond" style={{ fontSize: "1.35rem", fontWeight: 700, color: s.color, lineHeight: 1, textShadow: `0 0 8px ${s.color}44` }}>{s.value}</div>
              <div className="mono" style={{ fontSize: "0.5rem", color: "var(--textdim)", marginTop: "0.1rem" }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* ── MOBILE TABS ── */}
        <div style={{ display: "flex", background: "var(--bg2)", borderBottom: "1px solid var(--border)" }}>
          {(["map", "detail"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className="mono"
              style={{ flex: 1, padding: "0.5rem", background: "none", border: "none", borderBottom: `2px solid ${activeTab === tab ? "var(--blue)" : "transparent"}`, color: activeTab === tab ? "var(--blue)" : "var(--textdim)", fontSize: "0.62rem", letterSpacing: "0.1em", cursor: "pointer" }}>
              {tab === "map" ? "⬡ HEATMAP" : "📊 ZONE DETAIL"}
            </button>
          ))}
        </div>

        {/* ── MAIN ── */}
        <div style={{ display: "flex", minHeight: "calc(100vh - 54px - 72px - 36px)" }}>

          {/* ── LEFT: HEATMAP + TABLE ── */}
          <div style={{ width: "62%", flexShrink: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", overflow: "hidden", height: "calc(100vh - 54px - 72px - 36px)" }}>

            {/* Hex heatmap panel */}
            <div style={{ background: "var(--bg2)", borderBottom: "1px solid var(--border)", padding: "0.8rem 1rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem" }}>
                <div className="mono" style={{ fontSize: "0.65rem", color: "var(--textdim)", letterSpacing: "0.12em" }}>⬡ ZONE HEATMAP — GRID OVERVIEW</div>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  {(["Red","Amber","Green"] as const).map(r => (
                    <div key={r} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: getRiskColor(r) }} />
                      <span className="mono" style={{ fontSize: "0.55rem", color: "var(--textdim)" }}>{r.toUpperCase()}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 2, height: 340, overflow: "hidden", position: "relative" }}>
                {loading ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                    <span className="mono" style={{ fontSize: "0.62rem", color: "var(--textdim)" }}>LOADING FROM COSMOSDB…</span>
                  </div>
                ) : (
                  <HexHeatmap readings={readings} selectedZone={selectedZone} onSelect={selectZone} />
                )}
                {[["top:6px","left:6px","borderTop","borderLeft"],["top:6px","right:6px","borderTop","borderRight"],
                  ["bottom:6px","left:6px","borderBottom","borderLeft"],["bottom:6px","right:6px","borderBottom","borderRight"]
                ].map((corners, i) => (
                  <div key={i} style={{ position: "absolute", [corners[0].split(":")[0]]: corners[0].split(":")[1], [corners[1].split(":")[0]]: corners[1].split(":")[1], width: 12, height: 12, [corners[2]]: "1px solid #243545", [corners[3]]: "1px solid #243545" }} />
                ))}
              </div>
            </div>

            {/* Zone table */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0.8rem 1rem" }} className="scrollbar-thin">
              <div className="mono" style={{ fontSize: "1rem", color: "var(--textbright)", letterSpacing: "0.1em", marginBottom: "0.75rem", fontWeight: "bold" }}>
                ALL ZONES — {readings.length} FEEDERS
              </div>
              {error && (
                <div className="mono fade-up" style={{ marginBottom: "0.5rem", padding: "0.5rem 0.75rem", background: "#ff3b3b12", border: "1px solid #ff3b3b44", borderLeft: "3px solid var(--red)", fontSize: "0.6rem", color: "var(--red)", borderRadius: 2 }}>
                  {error}
                </div>
              )}
              {!loading && readings.length === 0 && !error && (
                <div className="mono" style={{ padding: "1.5rem", textAlign: "center", fontSize: "0.62rem", color: "var(--textdim)" }}>
                  NO READINGS — CLICK <span style={{ color: "var(--blue)" }}>▶ RUN INFERENCE</span>
                </div>
              )}
              {readings.length > 0 && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Share Tech Mono',monospace", fontSize: "0.9rem" }}>
                  <thead>
                    <tr>
                      {["ZONE", "STRESS", "RISK", "DRIVER", "UPDATED"].map((h) => (
                        <th key={h} style={{ color: "var(--textdim)", letterSpacing: "0.08em", padding: "0.65rem 0.75rem", textAlign: "left", borderBottom: "1px solid var(--border)", fontWeight: "normal" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {readings.map((r) => {
                      const color = getRiskColor(r.risk_category);
                      const isSel = selectedZone === r.zone_id;
                      return (
                        <tr key={r.zone_id} className="zone-row" onClick={() => selectZone(r.zone_id)}
                          style={{ background: isSel ? "var(--bg4)" : "transparent", borderLeft: isSel ? `2px solid ${color}` : "2px solid transparent" }}>
                          <td style={{ padding: "0.65rem 0.75rem", borderBottom: "1px solid var(--border)", color: "var(--textbright)", textTransform: "capitalize" }}>{r.zone_id.replace(/-/g, " ")}</td>
                          <td style={{ padding: "0.65rem 0.75rem", borderBottom: "1px solid var(--border)", color, fontWeight: "bold" }}>{r.stress_score.toFixed(1)}%</td>
                          <td style={{ padding: "0.65rem 0.75rem", borderBottom: "1px solid var(--border)" }}>
                            <span style={{ background: `${color}20`, color, border: `1px solid ${color}`, fontSize: "0.75rem", padding: "3px 7px", borderRadius: 1 }}>{r.risk_category.toUpperCase()}</span>
                          </td>
                          <td style={{ padding: "0.65rem 0.75rem", borderBottom: "1px solid var(--border)", color: "var(--textdim)", textTransform: "uppercase" }}>{r.primary_driver.replace(/_/g, " ")}</td>
                          <td style={{ padding: "0.65rem 0.75rem", borderBottom: "1px solid var(--border)", color: "var(--textdim)" }}>{fmt(r.timestamp)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ── RIGHT: DETAIL PANEL ── */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--bg2)", overflowY: "auto" }} className="scrollbar-thin">
            {!selectedZone ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "0.75rem", padding: "2rem" }}>
                <svg width="44" height="44" viewBox="0 0 32 32" fill="none" opacity="0.15">
                  <polygon points="16,2 30,28 2,28" fill="none" stroke="#0af" strokeWidth="1.5" />
                  <circle cx="16" cy="20" r="3" fill="#0af" />
                </svg>
                <div className="mono" style={{ fontSize: "0.62rem", color: "var(--textdim)", letterSpacing: "0.1em", textAlign: "center", lineHeight: 1.8 }}>
                  CLICK A HEX OR TABLE ROW<br />TO VIEW ZONE DETAILS
                </div>
              </div>
            ) : (
              <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>

                {/* Zone header */}
                {selectedReading && (
                  <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderLeft: `3px solid ${rc}`, borderRadius: 2, padding: "0.9rem" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "0.65rem" }}>
                      <div>
                        <div className="cond" style={{ fontWeight: 700, fontSize: "1.3rem", color: "var(--textbright)", textTransform: "capitalize", letterSpacing: "0.04em" }}>
                          {selectedReading.zone_id.replace(/-/g, " ")}
                        </div>
                        <div className="mono" style={{ fontSize: "0.54rem", color: "var(--textdim)", marginTop: 2 }}>
                          {selectedReading.zone_id.toUpperCase()} · Driver: <span style={{ color: "var(--text)" }}>{selectedReading.primary_driver}</span>
                        </div>
                      </div>
                      <span className="mono" style={{ background: `${rc}20`, color: rc, border: `1px solid ${rc}`, fontSize: "0.7rem", fontWeight: 700, padding: "3px 8px", borderRadius: 2, letterSpacing: "0.12em", boxShadow: `0 0 8px ${rc}44`, flexShrink: 0 }}>
                        {selectedReading.risk_category.toUpperCase()}
                      </span>
                    </div>
                    <div className="mono" style={{ fontSize: "0.54rem", color: "var(--textdim)", marginBottom: "0.35rem", letterSpacing: "0.08em" }}>STRESS INDEX</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", marginBottom: "0.65rem" }}>
                      <div style={{ flex: 1, height: 8, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 1, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${selectedReading.stress_score}%`, background: selectedReading.risk_category === "Red" ? "linear-gradient(90deg,var(--amber),var(--red))" : selectedReading.risk_category === "Amber" ? "linear-gradient(90deg,var(--green),var(--amber))" : "var(--green)", borderRadius: 1, transition: "width 0.6s ease", boxShadow: `0 0 6px ${rc}55` }} />
                      </div>
                      <div className="mono" style={{ fontSize: "1.3rem", fontWeight: "bold", color: rc, minWidth: 56, textAlign: "right", textShadow: `0 0 8px ${rc}66` }}>
                        {selectedReading.stress_score.toFixed(1)}%
                      </div>
                    </div>
                    {selectedReading.inputs && Object.keys(selectedReading.inputs).length > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.4rem" }}>
                        {Object.entries(selectedReading.inputs).map(([k, v]) => (
                          <div key={k} style={{ background: "var(--bg)", border: "1px solid var(--border)", padding: "0.35rem 0.4rem", borderRadius: 2, textAlign: "center" }}>
                            <div className="mono" style={{ fontSize: "0.75rem", color: "var(--textbright)", fontWeight: "bold" }}>
                              {typeof v === "number" ? v.toFixed(1) : String(v)}
                            </div>
                            <div className="mono" style={{ fontSize: "0.44rem", color: "var(--textdim)", marginTop: 1, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                              {k.replace(/_/g, " ")}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* SIMULATION BUTTON ADDED HERE */}
                    <button 
                      onClick={() => triggerInfer({ zone_id: selectedZone, active_demand_mw: 95, temp_c: 45 })}
                      disabled={triggering}
                      className="mono"
                      style={{ width: "100%", marginTop: "1rem", padding: "0.6rem", background: "#ff3b3b15", border: "1px solid #ff3b3b44", color: "var(--red)", fontSize: "0.6rem", cursor: "pointer", borderRadius: 2, letterSpacing: "0.1em" }}
                    >
                      ⚠ SIMULATE CRITICAL LOAD (95MW)
                    </button>
                  </div>
                )}

                {/* Forecast */}
                <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 2, padding: "0.9rem" }}>
                  <div className="mono" style={{ fontSize: "0.62rem", color: "var(--textdim)", letterSpacing: "0.1em", marginBottom: "0.65rem" }}>📈 STRESS FORECAST — 24HR</div>
                  {forecast.length === 0 ? (
                    <div className="mono" style={{ fontSize: "0.6rem", color: "var(--textdim)", padding: "1.2rem 0", textAlign: "center" }}>LOADING FORECAST…</div>
                  ) : (
                    <>
                      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 2, overflow: "hidden", height: 88, marginBottom: "0.4rem" }}>
                        <svg viewBox={`0 0 ${FW} ${FH}`} style={{ width: "100%", height: "100%" }} preserveAspectRatio="none">
                          <line x1="0" y1={yS(70)} x2={FW} y2={yS(70)} stroke="var(--red)" strokeWidth="0.5" strokeDasharray="4,3" opacity="0.5" />
                          <line x1="0" y1={yS(40)} x2={FW} y2={yS(40)} stroke="var(--amber)" strokeWidth="0.5" strokeDasharray="4,3" opacity="0.3" />
                          <text x="3" y={yS(70) - 2} fill="var(--red)" fontSize="6" fontFamily="monospace" opacity="0.7">70%</text>
                          {bandPts && <polygon points={bandPts} fill={`${rc}15`} />}
                          {linePts && <polyline points={linePts} fill="none" stroke={rc} strokeWidth="1.5" />}
                          {forecast[0] && <circle cx={xS(0)} cy={yS(forecast[0].stress_score)} r="3" fill={rc} />}
                        </svg>
                      </div>
                      <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: "0.49rem", color: "var(--textdim)", marginBottom: "0.5rem" }}>
                        <span>NOW</span><span>+6h</span><span>+12h</span><span>+18h</span><span>+24h</span>
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Share Tech Mono',monospace", fontSize: "0.58rem" }}>
                        <thead>
                          <tr>
                            {["HR+","LOWER","MEDIAN","UPPER"].map((h) => (
                              <th key={h} style={{ color: "var(--textdim)", letterSpacing: "0.08em", padding: "0.25rem 0.4rem", textAlign: h === "HR+" ? "left" : "right", borderBottom: "1px solid var(--border)", fontWeight: "normal" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {forecast.map((f) => {
                            const frc = f.stress_score >= 70 ? "var(--red)" : f.stress_score >= 40 ? "var(--amber)" : "var(--green)";
                            return (
                              <tr key={f.horizon_hr} style={{ borderBottom: "1px solid #1e2d3d44" }}>
                                <td style={{ padding: "0.25rem 0.4rem", color: "var(--textdim)" }}>+{f.horizon_hr}h</td>
                                <td style={{ padding: "0.25rem 0.4rem", textAlign: "right", color: "var(--blue)" }}>{f.stress_lower.toFixed(1)}%</td>
                                <td style={{ padding: "0.25rem 0.4rem", textAlign: "right", fontWeight: "bold", color: frc }}>{f.stress_score.toFixed(1)}%</td>
                                <td style={{ padding: "0.25rem 0.4rem", textAlign: "right", color: "var(--blue)" }}>{f.stress_upper.toFixed(1)}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>

                {/* Actions */}
                <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 2, padding: "0.9rem" }}>
                  <div className="mono" style={{ fontSize: "0.62rem", color: "var(--textdim)", letterSpacing: "0.1em", marginBottom: "0.65rem" }}>⚡ LOAD REDUCTION ACTIONS</div>
                  {actions.length === 0 ? (
                    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderLeft: "3px solid var(--green)", borderRadius: 2, padding: "0.65rem" }}>
                      <div className="mono" style={{ fontSize: "0.58rem", color: "var(--green)" }}>✓ NO ACTIONS — ZONE WITHIN SAFE LIMITS</div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                      {actions.map((a) => {
                        const arc = a.projected_stress >= 70 ? "var(--red)" : a.projected_stress >= 40 ? "var(--amber)" : "var(--green)";
                        return (
                          <div key={a.sequence} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderLeft: "3px solid var(--amber)", borderRadius: 2, padding: "0.55rem 0.65rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
                            <div className="mono" style={{ color: "var(--textdim)", fontSize: "0.56rem", minWidth: 18 }}>#{a.sequence}</div>
                            <div style={{ flex: 1 }}>
                              <div className="cond" style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--textbright)", textTransform: "capitalize" }}>
                                {a.zone_id.replace(/-/g, " ")}
                              </div>
                              <div className="mono" style={{ fontSize: "0.5rem", color: "var(--textdim)", textTransform: "uppercase", marginTop: 1 }}>{a.action_type}</div>
                            </div>
                            <div style={{ display: "flex", gap: "0.45rem", flexShrink: 0 }}>
                              {[
                                { v: `−${a.reduction_pct}%`, k: "CUT", c: "var(--amber)" },
                                { v: `${a.freed_mw}MW`, k: "FREED", c: "var(--blue)" },
                                { v: `→${a.projected_stress.toFixed(1)}%`, k: "PROJ", c: arc },
                              ].map((m) => (
                                <div key={m.k} style={{ textAlign: "center" }}>
                                  <div className="mono" style={{ fontSize: "0.72rem", fontWeight: "bold", color: m.c }}>{m.v}</div>
                                  <div className="mono" style={{ fontSize: "0.44rem", color: "var(--textdim)" }}>{m.k}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        </div>
      </div>
      <Toaster position="bottom-right" />
    </>
  );
}