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

# ── path so we can import the ML model folders ──────────────────────────────
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

# ── API key security ─────────────────────────────────────────────────────────
API_KEY = os.environ["API_KEY"]
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=True)


def verify_api_key(key: str = Security(api_key_header)):
    if not key or not secrets.compare_digest(key, API_KEY):
        raise HTTPException(status_code=403, detail="Invalid API key")
    return key


# ── simulated zone definitions ───────────────────────────────────────────────
ZONES = [
    {"zone_id": "zone-north", "capacity_mw": 500, "zone_type": "residential"},
    {"zone_id": "zone-south", "capacity_mw": 800, "zone_type": "industrial"},
    {"zone_id": "zone-east",  "capacity_mw": 400, "zone_type": "mixed"},
    {"zone_id": "zone-west",  "capacity_mw": 600, "zone_type": "commercial"},
    {"zone_id": "zone-central","capacity_mw": 700, "zone_type": "mixed"},
]


def _risk_category(score: float) -> str:
    if score >= 70:
        return "Red"
    elif score >= 40:
        return "Amber"
    return "Green"


def _simulate_input(zone: dict) -> dict:
    """Generate realistic-looking simulated sensor data for a zone."""
    hour = __import__("datetime").datetime.now().hour
    time_risk = round(0.9 if 17 <= hour <= 21 else 0.4 + random.random() * 0.3, 2)
    return {
        "temperature":       round(28 + random.random() * 18, 1),
        "humidity":          round(40 + random.random() * 40, 1),
        "load_pct":          round(0.5 + random.random() * 0.5, 2),
        "demand_spike_rate": round(random.random() * 0.6, 2),
        "time_risk":         time_risk,
        "event_flag":        random.choice([0, 0, 0, 1]),
    }


# ── Model 1 inference (lazy-loaded to avoid import-time cost) ────────────────
_model1_infer = None


def _get_model1():
    global _model1_infer
    if _model1_infer is None:
        import os, joblib, shap, pandas as pd

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


async def run_model1_all_zones():
    """Called by scheduler every 30 min and by POST /infer."""
    infer = _get_model1()
    results = []
    for zone in ZONES:
        inputs = _simulate_input(zone)
        raw = infer(inputs)
        raw["risk_category"] = _risk_category(raw["stress_score"])
        doc = await db.write_stress_reading(zone["zone_id"], inputs, raw)
        results.append(doc)

        # If Red or Amber → run Model 3
        if raw["risk_category"] in ("Red", "Amber"):
            import importlib.util as _ilu
            _spec = _ilu.spec_from_file_location("optimiser", os.path.join(BASE_DIR, "model3", "optimiser.py"))
            _mod = _ilu.module_from_spec(_spec)
            _spec.loader.exec_module(_mod)
            optimise = _mod.optimise
            zone_data = [{
                **zone,
                "stress_score":    raw["stress_score"],
                "current_load_mw": inputs["load_pct"] * zone["capacity_mw"],
                "cuts_this_week":  random.randint(0, 3),
                "fairness_weight": round(0.7 + random.random() * 0.3, 2),
            }]
            constraints = {
                "max_reduction_pct": 20,
                "max_cuts_per_week": 5,
                "must_not_cut":      [],
            }
            actions = optimise(zone_data, constraints)
            await db.write_actions(zone["zone_id"], actions)

    return results


async def _run_model1_safely():
    try:
        await run_model1_all_zones()
    except Exception:
        logger.exception("Scheduled Model 1 run failed")


# ── scheduler ────────────────────────────────────────────────────────────────
scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.validate_cosmos_setup()

    # Run once on startup
    asyncio.create_task(_run_model1_safely())
    # Then every 30 minutes
    scheduler.add_job(_run_model1_safely, "interval", minutes=30, id="model1-interval", replace_existing=True)
    scheduler.start()
    yield
    scheduler.shutdown()


# ── app ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="GridStress API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── endpoints ────────────────────────────────────────────────────────────────

@app.post("/infer", dependencies=[Depends(verify_api_key)])
async def infer_now():
    """Manually trigger Model 1 across all zones and persist results."""
    results = await run_model1_all_zones()
    return {"status": "ok", "zones_processed": len(results), "results": results}


@app.get("/stress/latest", dependencies=[Depends(verify_api_key)])
async def stress_latest():
    """Return the most recent stress reading per zone."""
    readings = await db.get_latest_readings()
    return {"readings": readings}


@app.get("/stress/history", dependencies=[Depends(verify_api_key)])
async def stress_history(zone_id: str, hours: int = 12):
    """Return up to `hours` past readings for a zone (feeds Model 2)."""
    history = await db.get_history(zone_id, hours)
    return {"zone_id": zone_id, "history": history}


@app.get("/forecast", dependencies=[Depends(verify_api_key)])
async def get_forecast(zone_id: str):
    """
    Return the latest 24-hr forecast for a zone.
    If none exists yet, run Model 2 on the fly using stored history.
    """
    existing = await db.get_latest_forecast(zone_id)
    if existing:
        return {"zone_id": zone_id, **existing}

    # Build forecast on-demand
    history_docs = await db.get_history(zone_id, 12)
    if len(history_docs) < 2:
        raise HTTPException(
            status_code=404,
            detail="Not enough history to generate forecast. Run /infer first.",
        )

    import importlib, sys as _sys
    m2_dir = os.path.join(BASE_DIR, "model2")
    import joblib as _jl, pandas as _pd
    FEATURE_COLS = _jl.load(os.path.join(m2_dir, "forecast_feature_columns.pkl"))
    mq16 = _jl.load(os.path.join(m2_dir, "forecast_model_q16.pkl"))
    mq50 = _jl.load(os.path.join(m2_dir, "forecast_model_q50.pkl"))
    mq84 = _jl.load(os.path.join(m2_dir, "forecast_model_q84.pkl"))
    HORIZONS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 22, 24]

    def _forecast(history, weather_forecast, event_flags):
        outputs = []
        for i, h in enumerate(HORIZONS):
            row = {}
            for j, past in enumerate(history):
                t = -12 + j * 2
                row[f"stress_t{t}"] = past["stress_score"]
                row[f"temp_t{t}"] = past["temperature"]
                row[f"load_t{t}"] = past["load_pct"]
            row["future_temperature"] = weather_forecast[i]["temperature"]
            row["future_humidity"] = weather_forecast[i]["humidity"]
            row["event_flag_future"] = event_flags[i]["flag"]
            row["horizon_hr"] = h
            X = _pd.DataFrame([row])[FEATURE_COLS]
            outputs.append({
                "horizon_hr": h,
                "stress_score": round(float(mq50.predict(X)[0]), 1),
                "stress_lower": round(float(mq16.predict(X)[0]), 1),
                "stress_upper": round(float(mq84.predict(X)[0]), 1),
            })
        return outputs

    history = [
        {
            "stress_score": h["stress_score"],
            "temperature":  h["inputs"]["temperature"],
            "load_pct":     h["inputs"]["load_pct"],
        }
        for h in reversed(history_docs[:7])
    ]
    # Pad to 7 if fewer readings exist
    while len(history) < 7:
        history.insert(0, history[0])

    weather_forecast = [
        {"temperature": round(28 + random.random() * 15, 1), "humidity": round(45 + random.random() * 35, 1)}
        for _ in range(12)
    ]
    event_flags = [{"flag": random.choice([0, 0, 1])} for _ in range(12)]

    forecast_result = _forecast(history, weather_forecast, event_flags)
    doc = await db.write_forecast(zone_id, forecast_result)
    return {"zone_id": zone_id, **doc}


@app.get("/actions", dependencies=[Depends(verify_api_key)])
async def get_actions(zone_id: str):
    """Return the latest load-reduction actions for a zone."""
    actions = await db.get_actions(zone_id)
    if not actions:
        raise HTTPException(status_code=404, detail="No actions found for this zone.")
    return {"zone_id": zone_id, **actions}


@app.get("/health")
async def health():
    return {"status": "ok"}
