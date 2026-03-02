import numpy as np
import pandas as pd

# ----------------------------
# configuration
# ----------------------------
N_ZONES = 30
DAYS = 7
STEP_HOURS = 2
HORIZONS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 22, 24]

np.random.seed(42)

# ----------------------------
# helper functions
# ----------------------------
def daily_load_pattern(hour):
    """Simulate daily demand curve"""
    return 0.6 + 0.3 * np.sin((hour - 12) * np.pi / 12)

def temperature_trend(day):
    """Slow multi-day heat trend"""
    return 35 + 4 * np.sin(day * np.pi / 7)

# ----------------------------
# generate time series per zone
# ----------------------------
rows = []

for zone in range(N_ZONES):
    stress_prev = np.random.uniform(25, 40)

    for day in range(DAYS):
        for step in range(0, 24, STEP_HOURS):
            hour = step

            load_pct = daily_load_pattern(hour) + np.random.normal(0, 0.05)
            load_pct = np.clip(load_pct, 0.4, 1.0)

            temperature = temperature_trend(day) + np.random.normal(0, 1.2)
            humidity = np.random.uniform(45, 75)

            event_flag = np.random.binomial(1, 0.08)
            demand_spike = np.random.uniform(0, 0.5) if event_flag else np.random.uniform(0, 0.2)

            # stress dynamics (autoregressive)
            stress = (
                0.6 * stress_prev +
                0.25 * load_pct * 100 +
                0.15 * (temperature / 50) * 100 +
                np.random.normal(0, 3)
            )

            stress = np.clip(stress, 0, 100)

            rows.append({
                "zone_id": zone,
                "day": day,
                "hour": hour,
                "stress": stress,
                "load_pct": load_pct,
                "temperature": temperature,
                "humidity": humidity,
                "event_flag": event_flag
            })

            stress_prev = stress

df = pd.DataFrame(rows)

# ----------------------------
# create supervised rows
# ----------------------------
supervised_rows = []

for zone_id in df["zone_id"].unique():
    zdf = df[df["zone_id"] == zone_id].reset_index(drop=True)

    for i in range(6, len(zdf)):
        history = zdf.iloc[i-6:i]
        current = zdf.iloc[i]

        for h in HORIZONS:
            idx = i + h // STEP_HOURS
            if idx >= len(zdf):
                continue

            future = zdf.iloc[idx]

            row = {}

            # past 12 hours
            for j, (_, r) in enumerate(history.iterrows()):
                row[f"stress_t{-12 + j*2}"] = r["stress"]
                row[f"temp_t{-12 + j*2}"] = r["temperature"]
                row[f"load_t{-12 + j*2}"] = r["load_pct"]

            # future knowns
            row["future_temperature"] = future["temperature"]
            row["future_humidity"] = future["humidity"]
            row["event_flag_future"] = future["event_flag"]

            # target
            row["target_stress"] = future["stress"]
            row["horizon_hr"] = h

            supervised_rows.append(row)

final_df = pd.DataFrame(supervised_rows)

# ----------------------------
# save
# ----------------------------
final_df.to_csv("model2/data/forecast_training_data.csv", index=False)
print("Forecast training data generated:", final_df.shape)