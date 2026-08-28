from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FILES = [
    "README.md",
    "docs/ARCHITECTURE.md",
    "docs/SECURITY_MODEL.md",
    "docs/ZERO_COST_POLICY.md",
    "docs/PHONE_ONLY_MODE.md",
    "docs/ROADMAP.md",
    "docs/PHASE_0_ACCEPTANCE.md",
    "schemas/agent-spec.schema.json",
    "catalog/OSS_CATALOG.yaml",
]


def require_files() -> None:
    missing = [path for path in REQUIRED_FILES if not (ROOT / path).is_file()]
    if missing:
        raise SystemExit(f"Missing required foundation files: {missing}")


def validate_agent_schema() -> None:
    schema_path = ROOT / "schemas/agent-spec.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))

    properties = schema.get("properties", {})
    budget = properties.get("budget_policy", {})
    budget_props = budget.get("properties", {})
    spend_rule = budget_props.get("max_monetary_spend_usd", {})

    if spend_rule.get("const") != 0:
        raise SystemExit(
            "Zero-Cost Gate violated: max_monetary_spend_usd must remain const=0"
        )

    model_policy = properties.get("model_policy", {})
    model_props = model_policy.get("properties", {})
    allow_paid = model_props.get("allow_paid", {})
    if allow_paid.get("const") is not False:
        raise SystemExit("Zero-Cost Gate violated: allow_paid must remain const=false")


def validate_policy_text() -> None:
    zero_cost = (ROOT / "docs/ZERO_COST_POLICY.md").read_text(encoding="utf-8")
    required_markers = [
        "MAX_MONETARY_SPEND_USD = 0",
        "Paid execution",
        "Fail Closed",
    ]
    for marker in required_markers:
        if marker not in zero_cost:
            raise SystemExit(f"Zero-cost policy marker missing: {marker}")


def validate_catalog() -> None:
    catalog = (ROOT / "catalog/OSS_CATALOG.yaml").read_text(encoding="utf-8")
    for decision in ("USE", "ADAPT", "STUDY", "WATCH", "REJECT"):
        if decision not in catalog:
            raise SystemExit(f"OSS decision state missing from catalog: {decision}")


def main() -> None:
    require_files()
    validate_agent_schema()
    validate_policy_text()
    validate_catalog()
    print("Phase 0 foundation validation: PASS")
    print("Mandatory monetary spend: 0 USD")


if __name__ == "__main__":
    main()
