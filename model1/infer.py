import pandas as pd
import joblib
import shap

model = joblib.load("stress_model.pkl")
explainer = shap.Explainer(model)

def infer(zone_input: dict):
    X = pd.DataFrame([zone_input])

    stress = model.predict(X)[0]
    shap_vals = explainer(X)

    driver = X.columns[
        abs(shap_vals.values[0]).argmax()
    ]

    # Optional mapping for presentation
    if driver in ["temperature", "humidity"]:
        driver = "heat_index"

    return {
        "stress_score": round(float(stress), 1),
        "primary_driver": driver
    }

if __name__ == "__main__":
    sample = {
        "temperature": 43.2,
        "humidity": 68,
        "load_pct": 0.98,
        "demand_spike_rate": 0.43,
        "time_risk": 0.65,
        "event_flag": 0
    }

    print(infer(sample))