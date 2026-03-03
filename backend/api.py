"""
FastAPI backend — API key protected endpoints + APScheduler for Model 1.

Start with:
    uvicorn backend.api:app --reload --port 8000
(run from the repo root: Microsoft-Azure-Hackathon/)
"""

import os
import sys
import random
import asyncio
import logging
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Security, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security.api_key import APIKeyHeader
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)

import backend.cosmosdb as db

logger = logging.getLogger("gridstress-api")
logging.basicConfig(level=logging.INFO)


def _validate_env() -> None:
    required = ["API_KEY", "COSMOS_ENDPOINT", "COSMOS_KEY"]
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")
    placeholder_values = {
        "REPLACE_WITH_YOUR_GENERATED_KEY",
        "YOUR_PRIMARY_KEY_HERE",
        "https://YOUR_ACCOUNT.documents.azure.com:443/",
    }
    if os.environ.get("API_KEY") in placeholder_values:
        raise RuntimeError("API_KEY is using a placeholder value. Update backend/.env.")


_validate_env()

# ── API key security ──────────────────────────────────────────────────────────
API_KEY = os.environ["API_KEY"]
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=True)


def verify_api_key(key: str = Security(api_key_header)):
    if not key or not secrets.compare_digest(key, API_KEY):
        raise HTTPException(status_code=403, detail="Invalid API key")
    return key


# ── zone definitions ──────────────────────────────────────────────────────────
ZONES = [
    {"zone_id": "zone-north",   "capacity_mw": 500, "zone_type": "residential"},
    {"zone_id": "zone-south",   "capacity_mw": 800, "zone_type": "industrial"},
    {"zone_id": "zone-east",    "capacity_mw": 400, "zone_type": "mixed"},
    {"zone_id": "zone-west",    "capacity_mw": 600, "zone_type": "commercial"},
    {"zone_id": "zone-central", "capacity_mw": 700, "zone_type": "mixed"},
]

ZONE_MAP = {z["zone_id"]: z for z in ZONES}

# Adjacency — cardinal pairs + everything connects to central
ADJACENCY: dict[str, list[str]] = {
    "zone-north":   ["zone-central", "zone-east", "zone-west"],
    "zone-south":   ["zone-central", "zone-east", "zone-west"],
    "zone-east":    ["zone-central", "zone-north", "zone-south"],
    "zone-west":    ["zone-central", "zone-north", "zone-south"],
    "zone-central": ["zone-north", "zone-south", "zone-east", "zone-west"],
}


def _risk_category(score: float) -> str:
    if score >= 70:
        return "Red"
    elif score >= 40:
        return "Amber"
    return "Green"


def _simulate_input(zone: dict, prev: dict | None = None) -> dict:
    """
    Generate sensor data that drifts from the previous reading if available,
    otherwise starts from a reasonable baseline.
    """
    hour = __import__("datetime").datetime.now().hour
    time_risk = round(0.9 if 17 <= hour <= 21 else 0.4 + random.random() * 0.3, 2)

    if prev and prev.get("inputs"):
        p = prev["inputs"]
        # drift ±10% from last reading rather than fully random
        def drift(val: float, lo: float, hi: float, delta: float) -> float:
            return round(max(lo, min(hi, val + (random.random() - 0.5) * delta)), 2)
        return {
            "temperature":       drift(p.get("temperature", 32),       18, 46,  4),
            "humidity":          drift(p.get("humidity", 55),           30, 90,  8),
            "load_pct":          drift(p.get("load_pct", 0.65),         0.3, 1.0, 0.1),
            "demand_spike_rate": drift(p.get("demand_spike_rate", 0.2), 0,   0.6, 0.1),
            "time_risk":         time_risk,
            "event_flag":        random.choice([0, 0, 0, 1]),
        }

    return {
        "temperature":       round(28 + random.random() * 18, 1),
        "humidity":          round(40 + random.random() * 40, 1),
        "load_pct":          round(0.5 + random.random() * 0.5, 2),
        "demand_spike_rate": round(random.random() * 0.6, 2),
        "time_risk":         time_risk,
        "event_flag":        random.choice([0, 0, 0, 1]),
    }


# ── Model 1 (lazy-loaded) ─────────────────────────────────────────────────────
_model1_infer = None


def _get_model1():
    global _model1_infer
    if _model1_infer is None:
        import joblib, shap, pandas as pd
        model_path = os.path.join(BASE_DIR, "model1", "stress_model.pkl")
        model = joblib.load(model_path)
        explainer = shap.Explainer(model)

        def infer(zone_input: dict):
            X = pd.DataFrame([zone_input])
            stress = model.predict(X)[0]
            shap_vals = explainer(X)
            driver = X.columns[abs(shap_vals.values[0]).argmax()]
            if driver in ["temperature", "humidity"]:
                driver = "heat_index"
            return {"stress_score": round(float(stress), 1), "primary_driver": driver}

        _model1_infer = infer
    return _model1_infer


# ── Model 2 helpers ───────────────────────────────────────────────────────────
def _load_model2():
    import joblib as _jl
    m2_dir = os.path.join(BASE_DIR, "model2")
    return (
        _jl.load(os.path.join(m2_dir, "forecast_feature_columns.pkl")),
        _jl.load(os.path.join(m2_dir, "forecast_model_q16.pkl")),
        _jl.load(os.path.join(m2_dir, "forecast_model_q50.pkl")),
        _jl.load(os.path.join(m2_dir, "forecast_model_q84.pkl")),
    )


HORIZONS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 22, 24]


def _run_model2(history: list[dict], load_pct_override: float | None = None) -> list[dict]:
    """
    Run Model 2 forecast.
    If load_pct_override is given, all future load values use that value
    (used to simulate post-cut scenario).
    """
    import pandas as _pd
    FEATURE_COLS, mq16, mq50, mq84 = _load_model2()

    # Build simulated weather + event flags for next 12 horizons
    weather = [
        {"temperature": round(28 + random.random() * 15, 1),
         "humidity":    round(45 + random.random() * 35, 1)}
        for _ in range(12)
    ]
    event_flags = [{"flag": random.choice([0, 0, 1])} for _ in range(12)]

    outputs = []
    for i, h in enumerate(HORIZONS):
        row = {}
        for j, past in enumerate(history):
            t = -12 + j * 2
            row[f"stress_t{t}"] = past["stress_score"]
            row[f"temp_t{t}"]   = past["temperature"]
            # apply load override if provided (post-cut simulation)
            row[f"load_t{t}"]   = load_pct_override if load_pct_override is not None else past["load_pct"]
        row["future_temperature"] = weather[i]["temperature"]
        row["future_humidity"]    = weather[i]["humidity"]
        row["event_flag_future"]  = event_flags[i]["flag"]
        row["horizon_hr"]         = h
        X = _pd.DataFrame([row])[FEATURE_COLS]
        outputs.append({
            "horizon_hr":   h,
            "stress_score": round(float(mq50.predict(X)[0]), 1),
            "stress_lower": round(float(mq16.predict(X)[0]), 1),
            "stress_upper": round(float(mq84.predict(X)[0]), 1),
        })
    return outputs


def _pad_history(history: list[dict]) -> list[dict]:
    """Ensure exactly 7 history entries, padding from oldest if needed."""
    while len(history) < 7:
        history.insert(0, history[0])
    return history[:7]


# ── Model 3 helpers ───────────────────────────────────────────────────────────
def _run_model3(zone: dict, stress_score: float, current_load_mw: float) -> list:
    import importlib.util as _ilu
    spec = _ilu.spec_from_file_location("optimiser", os.path.join(BASE_DIR, "model3", "optimiser.py"))
    mod = _ilu.module_from_spec(spec)
    spec.loader.exec_module(mod)

    zone_data = [{
        **zone,
        "stress_score":    stress_score,
        "current_load_mw": current_load_mw,
        "cuts_this_week":  random.randint(0, 3),
        "fairness_weight": round(0.7 + random.random() * 0.3, 2),
    }]
    constraints = {
        "max_reduction_pct": 20,
        "max_cuts_per_week": 5,
        "must_not_cut":      [],
    }
    return mod.optimise(zone_data, constraints)


# ── Spillover ─────────────────────────────────────────────────────────────────
def _apply_spillover(
    stress_map: dict[str, float],
    freed_mw_map: dict[str, float],
) -> dict[str, float]:
    """
    For each zone that freed MW, distribute stress reduction proportionally
    to adjacent zones weighted by their capacity.
    Returns a delta map {zone_id: stress_reduction}.
    """
    total_grid_capacity = sum(z["capacity_mw"] for z in ZONES)
    deltas: dict[str, float] = {z["zone_id"]: 0.0 for z in ZONES}

    for source_zone, freed_mw in freed_mw_map.items():
        if freed_mw <= 0:
            continue
        neighbours = ADJACENCY.get(source_zone, [])
        if not neighbours:
            continue
        total_neighbour_capacity = sum(ZONE_MAP[n]["capacity_mw"] for n in neighbours)

        for neighbour in neighbours:
            cap = ZONE_MAP[neighbour]["capacity_mw"]
            weight = cap / total_neighbour_capacity
            # stress reduction = (freed_mw * weight) / neighbour_capacity * 100
            reduction = (freed_mw * weight / cap) * 100
            deltas[neighbour] += round(reduction, 2)

    return deltas


# ── Core inference pipeline ───────────────────────────────────────────────────
async def run_inference_pipeline(
    zone_ids: list[str] | None = None,
    dry_run: bool = False,
) -> list[dict]:
    """
    New pipeline: Model 3 first → Model 2 with/without cuts → spillover.

    zone_ids: list of zone IDs to process. None = all zones.
    dry_run:  if True, nothing is written to CosmosDB.
    """
    target_zones = [z for z in ZONES if zone_ids is None or z["zone_id"] in zone_ids]

    # ── 1. Fetch current readings from DB (BEFORE state) ─────────────────────
    all_latest = await db.get_latest_readings()
    prev_map = {r["zone_id"]: r for r in all_latest}

    results = []
    freed_mw_map: dict[str, float] = {}  # used for spillover later

    for zone in target_zones:
        zid = zone["zone_id"]
        prev = prev_map.get(zid)

        # ── 2. Generate current sensor inputs (drift from previous) ──────────
        inputs = _simulate_input(zone, prev)
        current_load_mw = inputs["load_pct"] * zone["capacity_mw"]

        # ── 3. Score current state with Model 1 ──────────────────────────────
        infer = _get_model1()
        m1_out = infer(inputs)
        m1_out["risk_category"] = _risk_category(m1_out["stress_score"])

        before_score    = prev["stress_score"]    if prev else m1_out["stress_score"]
        before_category = prev["risk_category"]   if prev else m1_out["risk_category"]

        # ── 4. Run Model 3 if stressed ────────────────────────────────────────
        actions: list = []
        total_freed_mw = 0.0
        post_cut_load_pct = inputs["load_pct"]  # default: unchanged

        if m1_out["risk_category"] in ("Red", "Amber"):
            actions = _run_model3(zone, m1_out["stress_score"], current_load_mw)
            total_freed_mw = sum(a.get("freed_mw", 0) for a in actions)
            freed_mw_map[zid] = total_freed_mw

            # Compute post-cut load_pct for Model 2 input
            post_cut_load_mw  = max(0, current_load_mw - total_freed_mw)
            post_cut_load_pct = round(post_cut_load_mw / zone["capacity_mw"], 3)

        # ── 5. Fetch history for Model 2 ─────────────────────────────────────
        history_docs = await db.get_history(zid, 12)
        history = _pad_history([
            {
                "stress_score": h["stress_score"],
                "temperature":  h["inputs"]["temperature"],
                "load_pct":     h["inputs"]["load_pct"],
            }
            for h in reversed(history_docs)
        ])

        # ── 6. Run Model 2 — baseline (no action) ────────────────────────────
        forecast_baseline = _run_model2(history, load_pct_override=None)

        # ── 7. Run Model 2 — with cuts applied ───────────────────────────────
        forecast_with_cuts = _run_model2(history, load_pct_override=post_cut_load_pct)

        # AFTER score = Model 2 +2hr forecast WITH cuts applied
        after_score    = forecast_with_cuts[1]["stress_score"]  # horizon index 1 = +2hr
        after_category = _risk_category(after_score)

        result = {
            "zone_id":              zid,
            "stress_score_before":  before_score,
            "risk_category_before": before_category,
            "stress_score_after":   after_score,
            "risk_category_after":  after_category,
            "primary_driver":       m1_out["primary_driver"],
            "actions":              actions,
            "total_freed_mw":       total_freed_mw,
            "forecast_baseline":    forecast_baseline,    # "do nothing" line
            "forecast_with_cuts":   forecast_with_cuts,   # recovery line
            "inputs":               inputs,
            "m1_stress_score":      m1_out["stress_score"],
        }
        results.append(result)

        # ── 8. Write to DB if not dry run ─────────────────────────────────────
        if not dry_run:
            await db.write_stress_reading(zid, inputs, m1_out)
            if actions:
                await db.write_actions(zid, actions)
            await db.write_forecast(zid, forecast_with_cuts)

    # ── 9. Compute spillover across all processed zones ───────────────────────
    stress_map = {r["zone_id"]: r["stress_score_after"] for r in results}
    spillover_deltas = _apply_spillover(stress_map, freed_mw_map)

    for r in results:
        zid = r["zone_id"]
        delta = spillover_deltas.get(zid, 0.0)
        r["spillover_reduction"] = delta
        r["stress_score_after"]  = round(max(0, r["stress_score_after"] - delta), 1)
        r["risk_category_after"] = _risk_category(r["stress_score_after"])

    return results


# ── Scheduler wrapper ─────────────────────────────────────────────────────────
async def _scheduled_run():
    """Scheduler always runs all zones, writes to DB."""
    try:
        await run_inference_pipeline(zone_ids=None, dry_run=False)
    except Exception:
        logger.exception("Scheduled inference run failed")


scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.validate_cosmos_setup()
    asyncio.create_task(_scheduled_run())
    scheduler.add_job(_scheduled_run, "interval", minutes=30, id="inference-interval", replace_existing=True)
    scheduler.start()
    yield
    scheduler.shutdown()


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="GridStress API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/infer", dependencies=[Depends(verify_api_key)])
async def infer_now(dry_run: bool = False, zone_id: str | None = None):
    """
    Run the full inference pipeline.
    - zone_id: optional, run for one zone only. If omitted, runs all zones.
    - dry_run: if true, returns preview without writing to DB.
    """
    zone_ids = [zone_id] if zone_id else None
    results = await run_inference_pipeline(zone_ids=zone_ids, dry_run=dry_run)
    return {
        "status":          "preview" if dry_run else "ok",
        "dry_run":         dry_run,
        "zones_processed": len(results),
        "results":         results,
    }


@app.get("/stress/latest", dependencies=[Depends(verify_api_key)])
async def stress_latest():
    readings = await db.get_latest_readings()
    return {"readings": readings}


@app.get("/stress/history", dependencies=[Depends(verify_api_key)])
async def stress_history(zone_id: str, hours: int = 12):
    history = await db.get_history(zone_id, hours)
    return {"zone_id": zone_id, "history": history}


@app.get("/forecast", dependencies=[Depends(verify_api_key)])
async def get_forecast(zone_id: str):
    """Return latest forecast for a zone from DB."""
    existing = await db.get_latest_forecast(zone_id)
    if existing:
        return {"zone_id": zone_id, **existing}
    raise HTTPException(
        status_code=404,
        detail="No forecast found. Run /infer first.",
    )


@app.get("/actions", dependencies=[Depends(verify_api_key)])
async def get_actions(zone_id: str):
    actions = await db.get_actions(zone_id)
    if not actions:
        raise HTTPException(status_code=404, detail="No actions found for this zone.")
    return {"zone_id": zone_id, **actions}


@app.get("/health")
async def health():
    return {"status": "ok"}