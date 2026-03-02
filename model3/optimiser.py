def optimise(zones, constraints):
    actions = []
    seq = 1

    for z in zones:
        if z["zone_id"] in constraints["must_not_cut"]:
            continue
        if z["cuts_this_week"] >= constraints["max_cuts_per_week"]:
            continue

        # priority score
        penalty = 0.5 * z["cuts_this_week"]
        priority = z["stress_score"] * z["fairness_weight"] * (1 - penalty)

        z["priority"] = priority

    # sort by priority
    zones_sorted = sorted(
        [z for z in zones if "priority" in z],
        key=lambda x: x["priority"],
        reverse=True
    )

    for z in zones_sorted:
        reduction_pct = min(
            constraints["max_reduction_pct"],
            z["stress_score"] * 0.18
        )

        freed_mw = (reduction_pct / 100) * z["capacity_mw"]
        projected_stress = z["stress_score"] - reduction_pct * 1.3

        actions.append({
            "sequence": seq,
            "zone_id": z["zone_id"],
            "action_type": "reduce",
            "reduction_pct": round(reduction_pct, 1),
            "freed_mw": round(freed_mw, 1),
            "projected_stress": round(projected_stress, 1)
        })

        seq += 1

    return actions


# ----------------------------
# local test
# ----------------------------
if __name__ == "__main__":
    zones = [
        {
            "zone_id": "ZN-001",
            "stress_score": 74.2,
            "capacity_mw": 120,
            "current_load_mw": 104.4,
            "zone_type": "Residential",
            "cuts_this_week": 1,
            "fairness_weight": 1.0
        },
        {
            "zone_id": "ZN-004",
            "stress_score": 78.9,
            "capacity_mw": 110,
            "current_load_mw": 100.1,
            "zone_type": "Critical",
            "cuts_this_week": 0,
            "fairness_weight": 0.1
        }
    ]

    constraints = {
        "max_reduction_pct": 15,
        "max_cuts_per_week": 2,
        "must_not_cut": ["ZN-hospital"]
    }

    for a in optimise(zones, constraints):
        print(a)