#!/usr/bin/env python3
# Ichtus Workspace - Auto Installer
# Checks what's missing and installs everything needed

import os
import sys
import subprocess
import re
from pathlib import Path

def log(msg):
    print('[INSTALL] ' + msg)

def log_ok(msg):
    print('[OK] ' + msg)

def log_warn(msg):
    print('[WARN] ' + msg)

def log_info(msg):
    print('      ' + msg)

def run_cmd(cmd, show_output=False):
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=120)
        if show_output and result.stdout:
            for line in result.stdout.split('\n'):
                if line.strip():
                    log_info(line)
        return result.returncode == 0, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return False, '', 'Timed out'
    except Exception as e:
        return False, '', str(e)

def create_venv():
    log('Creating virtual environment...')
    
    venv_path = Path('.venv/Scripts/pip.exe')
    if venv_path.exists():
        log_ok('.venv already exists')
        return True
    
    success, _, err = run_cmd('python -m venv .venv')
    if success:
        log_ok('.venv created')
        return True
    else:
        log_warn('Failed to create .venv: ' + err[:100])
        return False

def install_packages():
    pip_path = Path('.venv/Scripts/pip.exe')
    if not pip_path.exists():
        log_warn('.venv not ready, skipping package install')
        return False
    
    log('Installing Python packages...')
    
    # Upgrade pip first
    log_info('Upgrading pip...')
    run_cmd(f'"{pip_path}" install --upgrade pip', True)
    
    # Install from requirements.txt
    log_info('Installing from requirements.txt...')
    success, _, err = run_cmd(f'"{pip_path}" install -r requirements.txt', True)
    if success:
        log_ok('Packages installed')
        return True
    else:
        log_warn('Some packages may have failed: ' + err[:100])
        return False

def verify_packages():
    log('Verifying packages...')
    python_exe = Path('.venv/Scripts/python.exe')
    if not python_exe.exists():
        log_warn('.venv not ready')
        return False
    result = run_cmd(f'"{python_exe}" -c "import zeroconf; print(zeroconf.__version__)"')
    if result[0]:
        log_ok('zeroconf verified')
        return True
    log_warn('zeroconf not properly installed')
    return False

def read_existing_firebase_config():
    """Read existing firebase-api-key.txt and return parsed values."""
    config = Path('firebase-api-key.txt')
    if not config.exists():
        return None
    
    content = config.read_text()
    if 'AIza' not in content:
        return None
    
    # Parse existing values
    values = {}
    try:
        # Extract apiKey
        match = re.search(r"apiKey:\s*['\"]([^'\"]+)['\"]", content)
        if match:
            values['apiKey'] = match.group(1)
        
        # Extract authDomain
        match = re.search(r"authDomain:\s*['\"]([^'\"]+)['\"]", content)
        if match:
            values['authDomain'] = match.group(1)
        
        # Extract projectId
        match = re.search(r"projectId:\s*['\"]([^'\"]+)['\"]", content)
        if match:
            values['projectId'] = match.group(1)
        
        # Extract storageBucket
        match = re.search(r"storageBucket:\s*['\"]([^'\"]+)['\"]", content)
        if match:
            values['storageBucket'] = match.group(1)
        
        # Extract messagingSenderId
        match = re.search(r"messagingSenderId:\s*['\"]([^'\"]+)['\"]", content)
        if match:
            values['messagingSenderId'] = match.group(1)
        
        # Extract appId
        match = re.search(r"appId:\s*['\"]([^'\"]+)['\"]", content)
        if match:
            values['appId'] = match.group(1)
        
        return values if values else None
    except Exception:
        return None

def check_firebase_config():
    config = Path('firebase-api-key.txt')
    if config.exists() and 'AIza' in config.read_text():
        return True
    return False

def prompt_firebase_config():
    log('Setting up Firebase configuration...')
    
    config = Path('firebase-api-key.txt')
    
    # If valid config exists, skip
    if config.exists() and 'AIza' in config.read_text():
        log_ok('Firebase config already set')
        return True
    
    # Check for existing firebase-api-key.txt to pre-fill values
    existing = read_existing_firebase_config()
    if existing:
        log_info('Found existing firebase-api-key.txt - using those values')
        print('')
        log_info('Press Enter to accept existing value, or type new value to change.')
        print('')
    else:
        print('')
        log_info('Enter your Firebase project values below.')
        log_info('Get these from: https://console.firebase.google.com/')
        log_info('  -> Project Settings -> General -> Your apps -> Web app')
        print('')
    
    try:
        print('')
        log_info('Required values:')
        
        # API Key
        default_key = existing.get('apiKey', '') if existing else ''
        prompt = '  API Key (apiKey)' + (f' [{default_key}]' if default_key else '') + ': '
        api_key = input(prompt).strip()
        if not api_key and default_key:
            api_key = default_key
        if not api_key:
            log_warn('API Key is required')
            return False
        
        # Project ID
        default_project = existing.get('projectId', '') if existing else ''
        prompt = '  Project ID (projectId)' + (f' [{default_project}]' if default_project else '') + ': '
        project_id = input(prompt).strip()
        if not project_id and default_project:
            project_id = default_project
        if not project_id:
            log_warn('Project ID is required')
            return False
        
        # App ID
        default_app = existing.get('appId', '') if existing else ''
        prompt = '  App ID (appId)' + (f' [{default_app}]' if default_app else '') + ': '
        app_id = input(prompt).strip()
        if not app_id and default_app:
            app_id = default_app
        if not app_id:
            log_warn('App ID is required')
            return False
        
        print('')
        log_info('Optional values (press Enter to accept default):')
        
        # Auth Domain
        default_auth = existing.get('authDomain', '') if existing else project_id + '.firebaseapp.com'
        auth_domain = input('  Auth Domain (authDomain) [' + default_auth + ']: ').strip()
        if not auth_domain:
            auth_domain = default_auth
        
        # Storage Bucket
        default_storage = existing.get('storageBucket', '') if existing else project_id + '.appspot.com'
        storage = input('  Storage Bucket (storageBucket) [' + default_storage + ']: ').strip()
        if not storage:
            storage = default_storage
        
        # Messaging Sender ID
        default_sender = existing.get('messagingSenderId', '000000000000') if existing else '000000000000'
        sender_id = input('  Messaging Sender ID (messagingSenderId) [' + default_sender + ']: ').strip()
        if not sender_id:
            sender_id = default_sender
        
        # Generate the config file
        config_content = f'''// Firebase Configuration for Ichtus Workspace
// AUTO-GENERATED - DO NOT EDIT MANUALLY

const firebaseConfig = {{
    apiKey: '{api_key}',
    authDomain: '{auth_domain}',
    projectId: '{project_id}',
    storageBucket: '{storage}',
    messagingSenderId: '{sender_id}',
    appId: '{app_id}'
}};
'''
        
        config.write_text(config_content)
        log_ok('Firebase config saved to firebase-api-key.txt')
        return True
        
    except EOFError:
        log_warn('Input cancelled by user')
        return False
    except Exception as e:
        log_warn('Error: ' + str(e))
        return False

def check_firestore_rules():
    return Path('firestore.rules').exists()

def main():
    all_installed = True
    print('')
    print('========================================')
    print('   ICHTUS WORKSPACE - AUTO INSTALLER')
    print('========================================')
    print('')
    
    # Check Python version first
    print('')
    print('[0/4] Python Version Check')
    print('--------------------------')
    if sys.version_info >= (3, 8):
        log_ok('Python ' + sys.version.split()[0] + ' OK')
    else:
        log_warn('Python 3.8+ required, found ' + sys.version.split()[0])
        all_installed = False
    
    # 1. Create virtual environment
    print('')
    print('[1/4] Virtual Environment')
    print('--------------------------')
    if not create_venv():
        all_installed = False
    
    # 2. Install Python packages
    print('')
    print('[2/4] Python Packages')
    print('--------------------------')
    if install_packages():
        if not verify_packages():
            all_installed = False
    else:
        all_installed = False
    
    # 3. Check Firebase config
    print('')
    print('[3/4] Firebase Configuration')
    print('--------------------------')
    if not check_firebase_config():
        if not prompt_firebase_config():
            all_installed = False
    else:
        log_ok('Firebase configured')
    
    # 4. Check Firestore rules
    print('')
    print('[4/4] Firestore Rules')
    print('--------------------------')
    if check_firestore_rules():
        log_ok('firestore.rules found')
    else:
        log_warn('firestore.rules not found')
        log_info('Copy the firestore.rules file to this directory')
        all_installed = False
    
    # Summary
    print('')
    print('========================================')
    print('   INSTALL SUMMARY')
    print('========================================')
    
    if all_installed:
        log_ok('All done!')
        print('')
        print('Run: start-server.bat')
    else:
        print('')
        print('[INFO] Please fix the items above, then run:')
        print('  start-server.bat')

if __name__ == '__main__':
    main()