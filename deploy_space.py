from __future__ import annotations
import os
from pathlib import Path
from huggingface_hub import HfApi

TOKEN = os.environ.get('HF_TOKEN', '').strip()
if not TOKEN:
    raise SystemExit('HF_TOKEN is required')
api = HfApi(token=TOKEN)
who = api.whoami()
username = who.get('name') or who.get('fullname') or who.get('user')
if not username:
    raise SystemExit('Could not resolve Hugging Face username')
repo_id = f"{username}/ProxyHarvest-V18"
api.create_repo(
    repo_id=repo_id,
    repo_type='space',
    space_sdk='gradio',
    space_hardware='zero-a10g',
    exist_ok=True,
    private=False,
)
api.upload_folder(
    repo_id=repo_id,
    repo_type='space',
    folder_path=str(Path(__file__).resolve().parent),
    ignore_patterns=['.git/*','__pycache__/*','*.pyc','.github/*','V18_VERIFICATION.json','SHA256SUMS.txt'],
    commit_message='Deploy ProxyHarvest V18 ZeroGPU',
)
print(f'https://huggingface.co/spaces/{repo_id}')
