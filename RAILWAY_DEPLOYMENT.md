# Railway Deployment Guide

## Why Railway Instead of Vercel?

Vercel has strict serverless limits (500MB ephemeral storage, 50MB function size). Railway is perfect for this project:

- **8GB RAM** available (more than enough for PyTorch)
- **Full Python support** with persistent storage
- **Docker-friendly** for custom configurations
- **$5/month** for hobby projects (first $5 free)
- **Auto-deploy** from GitHub on every push
- **Full ML stack support** - PyTorch, NumPy, etc.

## Quick Deploy to Railway

### Option 1: Deploy Button (Easiest)

1. Go to [Railway.app](https://railway.app/)
2. Click "Start a New Project"
3. Select "Deploy from GitHub repo"
4. Connect your GitHub account
5. Select the `FischerBot` repository
6. Railway will auto-detect Python and deploy

### Option 2: Railway CLI

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Link to project
railway link

# Deploy
railway up
```

### Option 3: GitHub Auto-Deploy

1. Connect Railway to your GitHub repo
2. Every push to `main` auto-deploys
3. That's it!

## Configuration

Railway automatically uses:
- `requirements.txt` - Installs all dependencies including PyTorch
- `Procfile` - Defines start command (gunicorn)
- `runtime.txt` - Specifies Python 3.9
- `railway.json` - Railway-specific config

## Environment Variables

Railway automatically provides:
- `PORT` - Port to bind to (handled by gunicorn)
- `RAILWAY_ENVIRONMENT` - "production"

No additional config needed!

## What Works on Railway

Everything works, including:

- ✅ Traditional FischerBot (alpha-beta search)
- ✅ ML-enhanced FischerBotML (if models are trained)
- ✅ PyTorch neural networks
- ✅ All difficulty levels
- ✅ Opening book
- ✅ Web interface
- ✅ All API endpoints
- ✅ Model training (if you want to train in production)

## Deployment Steps

1. **Push the code** (already done):
   ```bash
   git push origin main
   ```

2. **Go to Railway.app**:
   - Sign up/login with GitHub
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose `zoniin/FischerBot`

3. **Configure (automatic)**:
   - Railway detects Python
   - Installs from requirements.txt
   - Runs command from Procfile
   - Assigns a URL like `fischerbot-production.up.railway.app`

4. **Access your app**:
   - Railway provides a public URL
   - Example: `https://fischerbot-production.up.railway.app`

## Cost Estimate

Railway pricing (as of 2024):
- **Free tier**: $5 credit per month (enough for hobby projects)
- **Pro tier**: $5/month base + usage
- **Estimated cost**: ~$2-3/month for light traffic

Much better than Lambda's surprise bills!

## ML Model Deployment

Railway has persistent storage, so trained models work perfectly:

```bash
# Models in repo are automatically deployed
models/
  fischer_model_pytorch.pth (9.6MB)
  fischer_model_pytorch_best.pth (9.6MB)
```

The bot will automatically load these on startup.

## Monitoring

Railway dashboard shows:
- CPU usage
- Memory usage
- Deployment logs
- Request metrics
- Crash reports

## Alternatives to Railway

If you want other options:

### Render (Similar to Railway)
- Free tier available
- 512MB RAM free tier
- Auto-deploy from GitHub
- Might struggle with PyTorch on free tier

### Fly.io
- Free tier: 3 VMs with 256MB RAM each
- Full Docker support
- Global edge network
- Good for ML apps

### DigitalOcean App Platform
- $5/month minimum
- 512MB RAM
- Easy deployment
- Good performance

### Heroku
- $7/month for hobby tier
- Used to be free (RIP)
- Very mature platform
- Large slug size limits

## Troubleshooting

### Build Fails

Check Railway logs. Common issues:
- Python version mismatch → Set in `runtime.txt`
- Missing dependencies → Check `requirements.txt`
- Import errors → Check sys.path in app.py

### App Crashes

Check Railway logs for Python errors. The app has good error handling, so crashes are rare.

### Out of Memory

PyTorch CPU version uses ~300-400MB RAM. Railway free tier has 8GB, so this shouldn't happen.

### Slow Startup

First deployment takes 3-5 minutes (installing PyTorch). Subsequent deploys are faster (~1-2 minutes).

## Testing Deployment

After deployment:

1. **Check health endpoint**:
   ```bash
   curl https://your-app.railway.app/api/health
   ```

2. **Expected response**:
   ```json
   {
     "status": "healthy",
     "bot_available": true,
     "ml_available": true
   }
   ```

3. **Test a game**:
   ```bash
   curl -X POST https://your-app.railway.app/api/new_game \
     -H "Content-Type: application/json" \
     -d '{"difficulty": "medium"}'
   ```

## Comparison: Vercel vs Railway

| Feature | Vercel | Railway |
|---------|--------|---------|
| Size Limit | 50MB | 8GB RAM |
| PyTorch Support | ❌ | ✅ |
| Cost | Free (with limits) | $5/month credit free |
| ML Features | ❌ | ✅ |
| Deployment Speed | Fast | Medium |
| Auto-deploy | ✅ | ✅ |
| Custom Domain | ✅ | ✅ |

**Verdict**: Railway is perfect for this project.

## Production Checklist

Before going live:

- [x] requirements.txt includes all dependencies
- [x] gunicorn configured in Procfile
- [x] Python version specified in runtime.txt
- [x] Error handling in place
- [x] Health check endpoint working
- [x] Models included in repo (or .gitignore if too large)
- [ ] Custom domain configured (optional)
- [ ] Environment variables set (if needed)

## Next Steps

1. Deploy to Railway using steps above
2. Test the deployed app
3. (Optional) Configure custom domain
4. (Optional) Set up monitoring/alerts
5. Play chess!

---

**Summary**: Railway is the perfect platform for FischerBot. It supports the full ML stack, auto-deploys from GitHub, and costs ~$2-3/month. Deploy in 5 minutes with zero config.

For deployment help: https://docs.railway.app/
