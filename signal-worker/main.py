"""
Aiscern — Python Signal Worker
FastAPI service implementing Layers 1, 3, 4, and local SynthID detection.

Deploy to: Render.com Web Service (free tier) or HuggingFace Space (Docker)
POST /analyze-signals — main analysis endpoint
GET  /health         — health check
"""

import os
import time
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from typing import Optional

from analyzers.pixel_integrity      import analyze_pixel_integrity
from analyzers.diffusion_inversion  import diffusion_inversion_score
from analyzers.diffusion_snapback   import diffusion_snapback_score
from analyzers.noise_stats      import analyze_noise_stats
from analyzers.frequency_domain import analyze_frequency_domain
from analyzers.synthid_local    import check_synthid
from utils.image_loader         import load_image_from_url
from utils.evidence_builder     import build_layer_report

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Pydantic models ───────────────────────────────────────────────────────────

class TargetRegion(BaseModel):
    x:      float
    y:      float
    width:  float
    height: float
    reason: str

class AnalyzeRequest(BaseModel):
    imageUrl:      str
    jobId:         str
    targetRegions: list[TargetRegion] = []

class DiffusionRequest(BaseModel):
    imageUrl: str

class AnalyzeResponse(BaseModel):
    jobId:            str
    status:           str
    processingTimeMs: int
    layers:           list[dict]
    synthid:          dict
    error:            Optional[str] = None

# ── App ───────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Signal worker starting up")
    yield
    logger.info("Signal worker shutting down")

app = FastAPI(
    title="Aiscern Signal Worker",
    description="Forensic image analysis — Layers 1, 3, 4, SynthID",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────────────────
# Restrict cross-origin access to known Aiscern origins only.
# Do NOT use allow_origins=["*"] — this is an internal forensic API that
# processes image URLs; wildcard CORS would expose it to arbitrary third-party sites.
_RAW_ORIGINS = os.getenv("ALLOWED_ORIGINS", "https://aiscern.com")
ALLOWED_ORIGINS = [o.strip() for o in _RAW_ORIGINS.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    allow_credentials=False,
)

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    import torch
    gpu_available = torch.cuda.is_available() if True else False
    try:
        import torch
        gpu_available = torch.cuda.is_available()
        gpu_name      = torch.cuda.get_device_name(0) if gpu_available else None
        vram_gb       = round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1) if gpu_available else 0
    except Exception:
        gpu_available = False
        gpu_name      = None
        vram_gb       = 0
    return {
        "status":  "healthy",
        "service": "aiscern-signal-worker",
        "version": "2.0.0",
        "layers": {
            "l1_pixel":            "available",
            "l3_noise":            "available",
            "l4_frequency":        "available",
            "l5_diffusion":        "available" if gpu_available and vram_gb >= 4.0 else "unavailable_no_gpu",
            "l5b_snapback":        "available" if gpu_available and vram_gb >= 4.0 else "unavailable_no_gpu",
        },
        "gpu": {
            "available": gpu_available,
            "name":      gpu_name,
            "vram_gb":   vram_gb,
        },
        "timestamp": __import__("datetime").datetime.utcnow().isoformat(),
    }

@app.post("/diffusion-inversion")
async def diffusion_inversion_endpoint(req: DiffusionRequest):
    """
    Layer 5: DDIM inversion manifold test.
    Requires GPU with >=4GB VRAM. Returns 503 if GPU unavailable.
    """
    import torch
    if not torch.cuda.is_available():
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=503,
            content={"error": "GPU not available", "score": 0.5, "confidence": 0.0}
        )
    try:
        result = diffusion_inversion_score(req.imageUrl)
        return result
    except Exception as e:
        logger.error(f"[L5] Diffusion inversion failed: {e}", exc_info=True)
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "score": 0.5, "confidence": 0.0}
        )

@app.post("/diffusion-snapback")
async def diffusion_snapback_endpoint(req: DiffusionRequest):
    """
    Layer 5b: Diffusion snap-back multi-strength reconstruction dynamics.
    Runs 4 img2img passes. Requires GPU with >=4GB VRAM. Returns 503 if unavailable.
    """
    import torch
    if not torch.cuda.is_available():
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=503,
            content={"error": "GPU not available", "snapBackScore": 0.5, "confidence": 0.0}
        )
    try:
        result = diffusion_snapback_score(req.imageUrl)
        return result
    except Exception as e:
        logger.error(f"[L5b] Snap-back failed: {e}", exc_info=True)
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "snapBackScore": 0.5, "confidence": 0.0}
        )

@app.post("/analyze-signals", response_model=AnalyzeResponse)
async def analyze_signals(req: AnalyzeRequest):
    start_ms = int(time.time() * 1000)

    try:
        logger.info(f"[{req.jobId}] Loading image from {req.imageUrl[:60]}…")
        img_array, img_pil = await load_image_from_url(req.imageUrl)
        logger.info(f"[{req.jobId}] Image loaded: {img_array.shape}")

        target_regions = [r.dict() for r in req.targetRegions]

        # Run all 3 layers + SynthID in parallel-ish
        # (asyncio not used for CPU-bound numpy — run sequentially,
        #  use ThreadPoolExecutor if needed for production)
        layers = []

        # Layer 1: Pixel Integrity
        try:
            l1 = analyze_pixel_integrity(img_array, img_pil, target_regions)
            layers.append(l1)
            logger.info(f"[{req.jobId}] L1 score={l1['layerSuspicionScore']:.2f}")
        except Exception as e:
            logger.warning(f"[{req.jobId}] L1 failed: {e}")
            layers.append(build_layer_report(1, "Pixel Integrity", [], "failure", 0))

        # Layer 3: Noise & Statistical
        try:
            l3 = analyze_noise_stats(img_array, img_pil)
            layers.append(l3)
            logger.info(f"[{req.jobId}] L3 score={l3['layerSuspicionScore']:.2f}")
        except Exception as e:
            logger.warning(f"[{req.jobId}] L3 failed: {e}")
            layers.append(build_layer_report(3, "Noise & Statistical", [], "failure", 0))

        # Layer 4: Frequency Domain
        try:
            l4 = analyze_frequency_domain(img_array, img_pil, target_regions)
            layers.append(l4)
            logger.info(f"[{req.jobId}] L4 score={l4['layerSuspicionScore']:.2f}")
        except Exception as e:
            logger.warning(f"[{req.jobId}] L4 failed: {e}")
            layers.append(build_layer_report(4, "Frequency Domain", [], "failure", 0))

        # SynthID local check
        synthid = {"detected": False, "confidence": 0.0}
        try:
            synthid = check_synthid(img_array)
        except Exception as e:
            logger.warning(f"[{req.jobId}] SynthID check failed: {e}")

        elapsed = int(time.time() * 1000) - start_ms
        return AnalyzeResponse(
            jobId=req.jobId,
            status="success",
            processingTimeMs=elapsed,
            layers=layers,
            synthid=synthid,
        )

    except Exception as e:
        logger.error(f"[{req.jobId}] Fatal error: {e}", exc_info=True)
        elapsed = int(time.time() * 1000) - start_ms
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=False)
