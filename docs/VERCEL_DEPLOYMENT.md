# Vercel Deployment Guide

## Understanding Your Error

The error you encountered:
```
Running build in Washington, D.C., USA (East) – iad1
Build machine configuration: 2 cores, 8 GB
Cloning github.com/zoniin/FischerBot (Branch: main, Commit: 6595f0b)
Previous build caches not available.
Cloning completed: 194.000ms
Running "vercel build"
```

This error occurs because **Vercel couldn't find a proper configuration file or entry point** for your Python Flask application. The build process started but didn't know how to proceed.

## What Was Missing

Before the improvements, your repository was missing:
1. **`vercel.json`** - Configuration file telling Vercel how to build and deploy
2. **`api/` directory** - Serverless function entry point for Vercel
3. **Proper Python runtime configuration** - Telling Vercel this is a Python app

## New Configuration

### 1. `vercel.json`
```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/index.py",
      "use": "@vercel/python"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "api/index.py"
    }
  ],
  "env": {
    "PYTHON_VERSION": "3.9"
  }
}
```

This tells Vercel:
- Use Python runtime (`@vercel/python`)
- Entry point is `api/index.py`
- Route all requests to this serverless function
- Use Python 3.9

### 2. `api/index.py`

This is the serverless function entry point that adapts your Flask app for Vercel's serverless environment.

Key differences from regular Flask:
- No `app.run()` - Vercel handles the server
- Stateless architecture - game state in memory (use Redis for production)
- Cold starts - first request may be slower
- Timeout limits - 10 seconds (Hobby), 60 seconds (Pro)

## Deployment Steps

### Option 1: Vercel CLI (Recommended)

1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   ```

2. **Login**:
   ```bash
   vercel login
   ```

3. **Deploy from the FischerBot directory**:
   ```bash
   cd FischerBot
   vercel
   ```

4. **Follow the prompts**:
   - Set up and deploy? **Y**
   - Which scope? (select your account)
   - Link to existing project? **N**
   - Project name? **FischerBot** (or your choice)
   - Directory? **./** (current directory)

5. **For production deployment**:
   ```bash
   vercel --prod
   ```

### Option 2: GitHub Integration

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Add Vercel configuration and ML improvements"
   git push origin main
   ```

2. **Connect to Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New Project"
   - Import your GitHub repository
   - Vercel will auto-detect the configuration

3. **Deploy**:
   - Click "Deploy"
   - Vercel will build and deploy automatically

### Option 3: Vercel Dashboard

1. **Create a new project** on [vercel.com](https://vercel.com)
2. **Import your Git repository**
3. **Configure build settings**:
   - Framework Preset: **Other**
   - Root Directory: **.**
   - Build Command: (leave empty)
   - Output Directory: (leave empty)
4. **Click Deploy**

## Environment Variables

If needed, set these in Vercel dashboard:

- `SECRET_KEY`: Flask secret key
- `PYTHON_VERSION`: 3.9 (already in vercel.json)

To add environment variables:
1. Go to your project on Vercel
2. Settings → Environment Variables
3. Add variables
4. Redeploy

## Testing Locally

Before deploying, test locally:

```bash
cd FischerBot
pip install -r requirements.txt
python api/index.py
```

Visit `http://localhost:5000` to test.

## Common Issues and Solutions

### Issue 1: Build Timeout

**Symptom**: Build takes too long and fails
**Solution**:
- Remove large files from repository
- Use `.vercelignore` to exclude unnecessary files:
  ```
  __pycache__/
  *.pyc
  .git/
  venv/
  .env
  ```

### Issue 2: Import Errors

**Symptom**: `ModuleNotFoundError` during runtime
**Solution**:
- Ensure all dependencies are in `requirements.txt`
- Check Python version compatibility
- Verify import paths in `api/index.py`

### Issue 3: Cold Starts

**Symptom**: First request is slow
**Solution**:
- Keep the ML model small
- Consider lazy loading
- Use Vercel Pro for better cold start performance
- Cache the model in the serverless function

### Issue 4: Memory Limits

**Symptom**: Function runs out of memory
**Solution**:
- Optimize model size
- Use simpler models for serverless
- Upgrade to Vercel Pro (3008 MB memory)

### Issue 5: Function Timeout

**Symptom**: "Function execution timeout"
**Solution**:
- Reduce search depth
- Optimize ML inference
- Use smaller models
- Upgrade to Vercel Pro (60s timeout)

## Serverless Considerations

### Stateless Architecture

Vercel serverless functions are stateless, meaning:
- Game state stored in memory is lost between function invocations
- For production, use:
  - **Redis** (Upstash Redis recommended)
  - **Database** (PostgreSQL, MongoDB)
  - **Vercel KV** (key-value storage)

### Example with Redis:

```python
import redis
import os

# Connect to Redis
r = redis.from_url(os.environ.get('REDIS_URL'))

# Store game
r.set(f'game:{game_id}', json.dumps(game_data))

# Retrieve game
game_data = json.loads(r.get(f'game:{game_id}'))
```

### Model Loading

For production, optimize model loading:

```python
import os
from functools import lru_cache

@lru_cache(maxsize=1)
def get_ml_model():
    """Load model once and cache it."""
    model_path = os.path.join(os.path.dirname(__file__), '..', 'models', 'fischer_model.pkl')
    return FischerMLEngine(model_path)

# Use in handler
ml_engine = get_ml_model()
```

## Performance Optimization

### 1. Reduce Cold Starts
- Keep dependencies minimal
- Use lightweight models
- Cache heavy imports

### 2. Optimize Response Time
- Reduce search depth
- Use faster evaluation functions
- Cache common positions

### 3. Minimize Bundle Size
- Remove unused dependencies
- Use `.vercelignore`
- Compress model files

## Monitoring and Logs

View logs in Vercel dashboard:
1. Go to your project
2. Click on a deployment
3. View "Functions" tab
4. Click on your function to see logs

## Scaling Considerations

### Hobby Plan (Free)
- 100 GB bandwidth/month
- 10-second function timeout
- 1024 MB memory
- Good for: Personal projects, demos

### Pro Plan ($20/month)
- 1 TB bandwidth/month
- 60-second function timeout
- 3008 MB memory
- Good for: Production apps with moderate traffic

### Enterprise
- Custom limits
- Dedicated support
- Contact Vercel for pricing

## Alternative Deployment Options

If Vercel doesn't meet your needs:

### Render
- Easy Python deployment
- Free tier available
- Persistent storage
- `render.yaml` configuration

### Railway
- Simple deployment
- PostgreSQL included
- Free tier available
- Good for Python apps

### Heroku
- Classic PaaS
- Extensive documentation
- Persistent dynos
- Buildpacks for Python

### DigitalOcean App Platform
- $5/month starting tier
- Managed infrastructure
- Good performance
- Database options

## Next Steps

1. **Deploy to Vercel** using one of the methods above
2. **Test the deployment** by playing a game
3. **Train the ML model** locally and include it in the repo (optional)
4. **Monitor performance** and optimize as needed
5. **Set up Redis** for persistent game state (optional)

## Resources

- [Vercel Python Documentation](https://vercel.com/docs/functions/serverless-functions/runtimes/python)
- [Vercel CLI Documentation](https://vercel.com/docs/cli)
- [Serverless Functions Guide](https://vercel.com/docs/functions/serverless-functions)
- [Environment Variables](https://vercel.com/docs/projects/environment-variables)
