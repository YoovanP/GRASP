import numpy as np
import pandas as pd

def normalize(x):
    return (x - x.min()) / (x.max() - x.min())

def generate(n=5000, seed=42):
    np.random.seed(seed)

    temperature = np.random.uniform(30, 48, n)
    humidity = np.random.uniform(30, 80, n)
    load_pct = np.random.uniform(0.4, 1.0, n)
    demand_spike_rate = np.random.uniform(0.0, 0.6, n)
    time_risk = np.random.uniform(0.0, 1.0, n)
    event_flag = np.random.binomial(1, 0.15, n)

    heat_index = normalize(temperature) * normalize(humidity)
    noise = np.random.normal(0, 4, n)

    stress_score = (
        0.40 * load_pct +
        0.30 * heat_index +
        0.20 * demand_spike_rate +
        0.08 * time_risk +
        0.02 * event_flag
    ) * 100 + noise

    stress_score = np.clip(stress_score, 0, 100)

    df = pd.DataFrame({
        "temperature": temperature,
        "humidity": humidity,
        "load_pct": load_pct,
        "demand_spike_rate": demand_spike_rate,
        "time_risk": time_risk,
        "event_flag": event_flag,
        "stress_score": stress_score
    })

    return df

if __name__ == "__main__":
    df = generate()
    df.to_csv("data/stress_training_data.csv", index=False)
    print("Synthetic data generated:", df.shape)