import shap
import joblib
import pandas as pd

# Load model and data
model = joblib.load("stress_model.pkl")
X = pd.read_csv("data/stress_training_data.csv").drop("stress_score", axis=1)

# SHAP
explainer = shap.Explainer(model)
shap_values = explainer(X)

# Plot (optional)
shap.summary_plot(shap_values, X)