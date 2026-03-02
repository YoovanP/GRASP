import pandas as pd
import lightgbm as lgb
import joblib
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error

# ----------------------------
# load data
# ----------------------------
df = pd.read_csv("model2/data/forecast_training_data.csv")

FEATURE_COLS = [c for c in df.columns if c not in ["target_stress"]]

X = df[FEATURE_COLS]
y = df["target_stress"]

# split
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

# ----------------------------
# train quantile models
# ----------------------------
quantiles = [0.16, 0.50, 0.84]
models = {}

for q in quantiles:
    print(f"\nTraining quantile model: {q}")

    model = lgb.LGBMRegressor(
        objective="quantile",
        alpha=q,
        n_estimators=300,
        learning_rate=0.05,
        max_depth=6,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42
    )

    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    mae = mean_absolute_error(y_test, preds)

    print(f"MAE (q={q}): {mae:.2f}")

    joblib.dump(model, f"model2/forecast_model_q{int(q*100)}.pkl")
    models[q] = model

joblib.dump(FEATURE_COLS, "model2/forecast_feature_columns.pkl")

print("\nAll quantile models trained and saved.")