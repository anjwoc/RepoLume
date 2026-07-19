#!/bin/bash
set -e

# Ensure gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud is not installed. Please install Google Cloud SDK first."
    exit 1
fi

echo "Google Cloud Service Account Automation Setup"
echo "============================================="

# Get current project
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)

if [ -z "$PROJECT_ID" ]; then
    echo "Error: No Google Cloud project configured."
    echo "Please run: gcloud auth login && gcloud config set project [YOUR_PROJECT_ID]"
    exit 1
fi

echo "Current Project: $PROJECT_ID"

SA_NAME="gemini-cli-bot"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
mkdir -p secrets
KEY_FILE="$(pwd)/secrets/gcp-sa-key.json"

echo "1. Checking if Service Account ($SA_NAME) exists..."
if ! gcloud iam service-accounts describe $SA_EMAIL &>/dev/null; then
    echo "   Creating Service Account: $SA_NAME..."
    gcloud iam service-accounts create $SA_NAME --display-name="Gemini CLI Bot for Local Deepwiki"
else
    echo "   Service Account already exists."
fi

echo "2. Assigning 'Vertex AI User' and 'Cloud AI Companion User' roles..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/aiplatform.user" >/dev/null

# Also add cloudaicompanion permission in case it's needed for cloudcode-pa.googleapis.com
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/cloudaicompanion.user" >/dev/null 2>&1 || true # Ignore if role doesn't exist

echo "3. Downloading JSON key to $KEY_FILE..."
if [ -f "$KEY_FILE" ]; then
    echo "   Key already exists. Overwriting..."
fi
gcloud iam service-accounts keys create "$KEY_FILE" \
  --iam-account="$SA_EMAIL"

echo "4. Registering in .env..."
if [ ! -f .env ]; then
    touch .env
fi

# Remove existing GOOGLE_APPLICATION_CREDENTIALS line if any
sed -i.bak '/GOOGLE_APPLICATION_CREDENTIALS/d' .env && rm -f .env.bak

echo "GOOGLE_APPLICATION_CREDENTIALS=$KEY_FILE" >> .env

echo "============================================="
echo "✅ Setup Complete!"
echo "The JSON key has been downloaded to: $KEY_FILE"
echo "And automatically registered in your .env file."
echo ""
echo "Please restart your RepoLume backend for changes to take effect:"
echo "  pnpm run dev:all"
