import unittest

from backend.ast_parser import extract_top_level_uppercase_numbers
from backend.compiler import compile_and_extract_parameters, execute_python_code


EXAMPLE_BUILD123D_SCRIPT = """from build123d import *

# --- PARAMETERS ---
BASE_LENGTH = 50.0
BASE_WIDTH = 50.0
BASE_THICKNESS = 5.0
HOLE_DIAM = 4.0

# --- LOGIC ---
with BuildPart() as result_part:
    Box(BASE_LENGTH, BASE_WIDTH, BASE_THICKNESS)
    # Semantic Topology: Find top face, draw sketch, extrude cut
    top_face = result_part.faces().sort_by(Axis.Z)[-1]
    with BuildSketch(top_face):
        with GridLocations(BASE_LENGTH - 10, BASE_WIDTH - 10, 2, 2):
            Circle(HOLE_DIAM / 2)
    extrude(amount=-BASE_THICKNESS, mode=Mode.SUBTRACT)

# --- EXPORT ---
result_part.part.export_gltf('output.glb')
"""


class CompilerTests(unittest.TestCase):
    def test_extracts_parameters_from_example_prompt_script(self) -> None:
        params = extract_top_level_uppercase_numbers(EXAMPLE_BUILD123D_SCRIPT)

        self.assertEqual(
            params,
            {
                "BASE_LENGTH": 50.0,
                "BASE_WIDTH": 50.0,
                "BASE_THICKNESS": 5.0,
                "HOLE_DIAM": 4.0,
            },
        )

    def test_subprocess_runner_executes_python_string(self) -> None:
        result = execute_python_code("print('ok')")

        self.assertEqual(result.returncode, 0)
        self.assertIn("ok", result.stdout)
        self.assertEqual(result.stderr, "")

    def test_compile_and_extract_parameters_returns_both_outputs(self) -> None:
        result, params = compile_and_extract_parameters("SIZE = 10\nprint(SIZE)")

        self.assertEqual(result.returncode, 0)
        self.assertIn("10", result.stdout)
        self.assertEqual(params, {"SIZE": 10.0})


if __name__ == "__main__":
    unittest.main()
