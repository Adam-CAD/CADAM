"""Utilities for extracting top-level CAD parameters from Python source."""

from __future__ import annotations

import ast
from typing import Dict


NUMERIC_TYPES = (int, float)


def extract_top_level_uppercase_numbers(code: str) -> Dict[str, float]:
    """Extract top-level ALL_CAPS numeric assignments from source code.

    Only assignments in module scope are considered. Supported value forms:
    - int / float constants
    - unary +/- numeric constants
    """

    tree = ast.parse(code)
    parameters: Dict[str, float] = {}

    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue

        if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue

        name = node.targets[0].id
        if name.upper() != name:
            continue

        value_node = node.value
        numeric_value: float | None = None

        if isinstance(value_node, ast.Constant) and isinstance(value_node.value, NUMERIC_TYPES):
            numeric_value = float(value_node.value)
        elif (
            isinstance(value_node, ast.UnaryOp)
            and isinstance(value_node.op, (ast.UAdd, ast.USub))
            and isinstance(value_node.operand, ast.Constant)
            and isinstance(value_node.operand.value, NUMERIC_TYPES)
        ):
            operand = float(value_node.operand.value)
            numeric_value = operand if isinstance(value_node.op, ast.UAdd) else -operand

        if numeric_value is not None:
            parameters[name] = numeric_value

    return parameters
