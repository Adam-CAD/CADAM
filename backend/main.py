from fastapi import FastAPI

app = FastAPI(title="Neuro-CAD Backend")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
