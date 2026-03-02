import pandas as pd
import joblib

FEATURE_COLS = joblib.load("model2/forecast_feature_columns.pkl")

# ----------------------------
# load trained models
# ----------------------------
model_q16 = joblib.load("model2/forecast_model_q16.pkl")
model_q50 = joblib.load("model2/forecast_model_q50.pkl")
model_q84 = joblib.load("model2/forecast_model_q84.pkl")

HORIZONS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 22, 24]

# ----------------------------
# inference function
# ----------------------------
def forecast(history, weather_forecast, event_flags):
    """
    history: list of dicts (length 7)
    weather_forecast: list of dicts (length 12)
    event_flags: list of dicts (length 12)
    """

    outputs = []

    for i, h in enumerate(HORIZONS):
        row = {}

        # ---- past 12 hours ----
        for j, past in enumerate(history):
            t = -12 + j * 2
            row[f"stress_t{t}"] = past["stress_score"]
            row[f"temp_t{t}"] = past["temperature"]
            row[f"load_t{t}"] = past["load_pct"]

        # ---- future knowns ----
        row["future_temperature"] = weather_forecast[i]["temperature"]
        row["future_humidity"] = weather_forecast[i]["humidity"]
        row["event_flag_future"] = event_flags[i]["flag"]
        
        row["horizon_hr"] = h

        X = pd.DataFrame([row])[FEATURE_COLS]

        s16 = model_q16.predict(X)[0]
        s50 = model_q50.predict(X)[0]
        s84 = model_q84.predict(X)[0]

        outputs.append({
            "horizon_hr": h,
            "stress_score": round(float(s50), 1),
            "stress_lower": round(float(s16), 1),
            "stress_upper": round(float(s84), 1)
        })

    return outputs


# ----------------------------
# local test
# ----------------------------
if __name__ == "__main__":

    history = [
        {"stress_score": 61.0, "temperature": 40.1, "load_pct": 0.79},
        {"stress_score": 63.2, "temperature": 41.0, "load_pct": 0.81},
        {"stress_score": 65.5, "temperature": 41.8, "load_pct": 0.83},
        {"stress_score": 67.1, "temperature": 42.5, "load_pct": 0.84},
        {"stress_score": 70.8, "temperature": 43.0, "load_pct": 0.85},
        {"stress_score": 72.4, "temperature": 43.1, "load_pct": 0.86},
        {"stress_score": 74.2, "temperature": 43.2, "load_pct": 0.87},
    ]

    weather_forecast = [
        {"temperature": 44.0, "humidity": 70},
        {"temperature": 44.5, "humidity": 71},
        {"temperature": 44.8, "humidity": 72},
        {"temperature": 44.2, "humidity": 70},
        {"temperature": 43.5, "humidity": 68},
        {"temperature": 42.0, "humidity": 65},
        {"temperature": 41.0, "humidity": 62},
        {"temperature": 40.5, "humidity": 60},
        {"temperature": 39.8, "humidity": 58},
        {"temperature": 39.2, "humidity": 56},
        {"temperature": 38.9, "humidity": 54},
        {"temperature": 38.5, "humidity": 52},
    ]

    event_flags = [{"flag": 0} for _ in range(12)]

    forecast_output = forecast(history, weather_forecast, event_flags)

    for f in forecast_output:
        print(f)