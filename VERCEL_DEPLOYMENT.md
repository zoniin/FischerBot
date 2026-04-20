# Vercel Deployment Guide

## Why ML Features Are Disabled on Vercel

Vercel serverless functions have a **50MB uncompressed size limit**. PyTorch alone is 100-200+ MB, which exceeds this limit.

## Solution

The deployment uses two separate requirements files:

1. **requirements.txt** (Full version - for local development)
   - Includes PyTorch, NumPy, and all ML dependencies
   - Use this for local development and training

2. **requirements-vercel.txt** (Minimal version - for Vercel deployment)
   - Only includes chess, Flask, and Flask-CORS
   - Excludes PyTorch and ML dependencies
   - Keeps deployment under size limits

## What Works on Vercel

- Traditional FischerBot (alpha-beta search)
- Opening book
- All difficulty levels (easy/medium/hard)
- Web interface
- API endpoints

## What's Disabled on Vercel

- ML predictions (PyTorch models)
- FischerBotML hybrid mode
- Model training

## Deployment

The vercel.json is configured to use requirements-vercel.txt automatically:

```json
{
  "installCommand": "pip install -r requirements-vercel.txt"
}
```

## Alternative Deployment Options

If you need full ML functionality in production, consider these platforms with larger size limits:

1. **Railway** - 2GB memory, supports PyTorch
2. **Render** - Up to 512MB, can handle PyTorch CPU
3. **AWS Lambda with Layers** - Up to 250MB uncompressed per layer
4. **Google Cloud Run** - Up to 4GB memory, full Docker support
5. **DigitalOcean App Platform** - Full Docker support
6. **Fly.io** - Full Docker support, good for ML apps

## Local Development

For local development with full ML features:

```bash
# Install full dependencies
pip install -r requirements.txt

# Train the model
python train_model_pytorch.py --epochs 100

# Run locally with ML enabled
python web/fischer/app.py
```

## API Behavior

The api/index.py automatically detects available features:

- If PyTorch is not installed: Falls back to traditional search
- If model files are missing: Uses FischerBot instead of FischerBotML
- Health endpoint reports ML availability: `/api/health`

## Testing Deployment

After deploying to Vercel:

1. Check health endpoint: `https://your-app.vercel.app/api/health`
2. Expected response:
   ```json
   {
     "status": "healthy",
     "bot_available": true,
     "ml_available": false
   }
   ```

3. Test a game:
   ```bash
   curl -X POST https://your-app.vercel.app/api/new_game \
     -H "Content-Type: application/json" \
     -d '{"difficulty": "medium"}'
   ```

## Troubleshooting

### Build Fails with "Function size exceeded"

Make sure vercel.json is using requirements-vercel.txt:
```json
"installCommand": "pip install -r requirements-vercel.txt"
```

### Import Errors

Verify that api/index.py has proper try/except blocks for ML imports (it does).

### 500 Errors

Check Vercel logs for Python errors. Most common issues:
- Missing chess library (should be in requirements-vercel.txt)
- Import path issues (fixed with sys.path.insert)
- Template file not found (fallback to JSON response)

---

**Summary**: The traditional FischerBot works perfectly on Vercel. For ML features, deploy to a platform with larger size limits or use the web interface locally.
