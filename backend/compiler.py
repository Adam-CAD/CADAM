"""Native subprocess compiler utilities for generated CAD Python code."""

from __future__ import annotations

import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .ast_parser import extract_top_level_uppercase_numbers


@dataclass
class ExecutionResult:
    returncode: int
    stdout: str
    stderr: str
    output_glb_path: Path


def execute_python_code(code: str) -> ExecutionResult:
    """Execute arbitrary Python code in a secure temporary directory.

    The function writes source to a temporary file, executes it with the current
    Python interpreter, and returns process output along with the expected GLB path.
    """

    with tempfile.TemporaryDirectory(prefix="cadam_compile_") as temp_dir:
        temp_path = Path(temp_dir)
        script_path = temp_path / "temp.py"
        output_glb_path = temp_path / "output.glb"

        script_path.write_text(code, encoding="utf-8")

        completed = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True,
            text=True,
            cwd=temp_path,
            check=False,
        )

        return ExecutionResult(
            returncode=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
            output_glb_path=output_glb_path,
        )


def compile_and_extract_parameters(code: str) -> tuple[ExecutionResult, dict[str, float]]:
    """Run generated code and parse top-level ALL_CAPS numeric parameters via AST."""

    result = execute_python_code(code)
    parameters = extract_top_level_uppercase_numbers(code)
    return result, parameters
