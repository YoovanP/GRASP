"""
CosmosDB client — async helpers for all three containers.
Containers:
  - stress_readings   (partition key: /zone_id)
  - stress_forecasts  (partition key: /zone_id)
  - load_actions      (partition key: /zone_id)
"""

import os
import uuid
from datetime import datetime, timezone
from azure.cosmos.aio import CosmosClient
from dotenv import load_dotenv

load_dotenv(override=True)

ENDPOINT = os.environ["COSMOS_ENDPOINT"]
KEY = os.environ["COSMOS_KEY"]
DATABASE_NAME = os.environ.get("COSMOS_DATABASE", "gridstress-db")

CONTAINER_STRESS = "stress_readings"
CONTAINER_FORECAST = "stress_forecasts"
CONTAINER_ACTIONS = "load_actions"


def _client():
    return CosmosClient(ENDPOINT, credential=KEY)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def validate_cosmos_setup() -> None:
    """Fail fast on startup if DB/containers are unreachable or missing."""
    async with _client() as client:
        db = client.get_database_client(DATABASE_NAME)
        await db.read()
        for container_name in (CONTAINER_STRESS, CONTAINER_FORECAST, CONTAINER_ACTIONS):
            container = db.get_container_client(container_name)
            await container.read()


# ---------------------------------------------------------------------------
# stress_readings
# ---------------------------------------------------------------------------

async def write_stress_reading(zone_id: str, inputs: dict, outputs: dict) -> dict:
    """Write a Model 1 result to CosmosDB."""
    doc = {
        "id": str(uuid.uuid4()),
        "zone_id": zone_id,
        "timestamp": _now_iso(),
        "inputs": inputs,
        "stress_score": outputs["stress_score"],
        "risk_category": outputs["risk_category"],
        "primary_driver": outputs["primary_driver"],
    }
    async with _client() as client:
        db = client.get_database_client(DATABASE_NAME)
        container = db.get_container_client(CONTAINER_STRESS)
        await container.create_item(doc)
    return doc


async def get_latest_readings() -> list:
    """Return the single most-recent reading per zone."""
    query = """
        SELECT c.zone_id, c.timestamp, c.stress_score, c.risk_category,
               c.primary_driver, c.inputs
        FROM   c
        WHERE  c.timestamp = (
            SELECT VALUE MAX(c2.timestamp)
            FROM   c2
            WHERE  c2.zone_id = c.zone_id
        )
    """
    # Simpler cross-partition approach: fetch last 50 and deduplicate in Python
    query = (
        "SELECT TOP 50 c.zone_id, c.timestamp, c.stress_score, "
        "c.risk_category, c.primary_driver, c.inputs "
        "FROM c ORDER BY c._ts DESC"
    )
    results = []
    async with _client() as client:
        db = client.get_database_client(DATABASE_NAME)
        container = db.get_container_client(CONTAINER_STRESS)
        async for item in container.query_items(query=query):
            results.append(item)

    # deduplicate — keep latest per zone
    seen = {}
    for r in results:
        if r["zone_id"] not in seen:
            seen[r["zone_id"]] = r
    return list(seen.values())


async def get_history(zone_id: str, hours: int = 12) -> list:
    """Return up to `hours` worth of readings for a zone (newest first)."""
    query = (
        f"SELECT TOP {hours} c.timestamp, c.stress_score, c.inputs "
        f"FROM c WHERE c.zone_id = @zone_id ORDER BY c._ts DESC"
    )
    results = []
    async with _client() as client:
        db = client.get_database_client(DATABASE_NAME)
        container = db.get_container_client(CONTAINER_STRESS)
        async for item in container.query_items(
            query=query,
            parameters=[{"name": "@zone_id", "value": zone_id}],
        ):
            results.append(item)
    return results


# ---------------------------------------------------------------------------
# stress_forecasts
# ---------------------------------------------------------------------------

async def write_forecast(zone_id: str, forecast: list) -> dict:
    """Write a Model 2 24-hr forecast array to CosmosDB."""
    doc = {
        "id": str(uuid.uuid4()),
        "zone_id": zone_id,
        "timestamp": _now_iso(),
        "forecast": forecast,
    }
    async with _client() as client:
        db = client.get_database_client(DATABASE_NAME)
        container = db.get_container_client(CONTAINER_FORECAST)
        await container.create_item(doc)
    return doc


async def get_latest_forecast(zone_id: str) -> dict | None:
    """Return the most recent forecast for a zone."""
    query = (
        "SELECT TOP 1 c.timestamp, c.forecast "
        "FROM c WHERE c.zone_id = @zone_id ORDER BY c._ts DESC"
    )
    async with _client() as client:
        db = client.get_database_client(DATABASE_NAME)
        container = db.get_container_client(CONTAINER_FORECAST)
        async for item in container.query_items(
            query=query,
            parameters=[{"name": "@zone_id", "value": zone_id}],
        ):
            return item
    return None


# ---------------------------------------------------------------------------
# load_actions
# ---------------------------------------------------------------------------

async def write_actions(zone_id: str, actions: list) -> dict:
    """Write Model 3 optimiser results to CosmosDB."""
    doc = {
        "id": str(uuid.uuid4()),
        "zone_id": zone_id,
        "timestamp": _now_iso(),
        "actions": actions,
    }
    async with _client() as client:
        db = client.get_database_client(DATABASE_NAME)
        container = db.get_container_client(CONTAINER_ACTIONS)
        await container.create_item(doc)
    return doc


async def get_actions(zone_id: str) -> dict | None:
    """Return the most recent action set for a zone."""
    query = (
        "SELECT TOP 1 c.timestamp, c.actions "
        "FROM c WHERE c.zone_id = @zone_id ORDER BY c._ts DESC"
    )
    async with _client() as client:
        db = client.get_database_client(DATABASE_NAME)
        container = db.get_container_client(CONTAINER_ACTIONS)
        async for item in container.query_items(
            query=query,
            parameters=[{"name": "@zone_id", "value": zone_id}],
        ):
            return item
    return None
