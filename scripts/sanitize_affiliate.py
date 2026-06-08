import json
import re
from pathlib import Path

cache_path = Path('/Users/jaecjeong/.adalflow/wikicache/localwiki_cache_local_local_affiliate_en_agy-gemini-3.5-flash-high.json')

with open(cache_path, 'r', encoding='utf-8') as f:
    text = f.read()

# Define replacement dictionary
replacements = {
    # URLs and Domains
    r'gmarket\.com': 'example.com',
    r'gmarket\.co\.kr': 'example.co.kr',
    r'github\.gmarket\.com': 'github.internal.com',
    
    # Internal Names
    r'\bLinkrew\b': 'PartnerPlatform',
    r'\blinkrew\b': 'partner-platform',
    r'\bJeju-do\b': 'CS-Platform',
    r'\bJeju\b': 'CS-Platform',
    r'\bHanAuthAPI\b': 'LegacyAuthAPI',
    r'\bHanCoreAPI\b': 'LegacyCoreAPI',
    r'\bSaturn\b': 'InternalFramework',
    
    # Servers
    r'\bfusiond3\b': 'internal-server-dev',
    r'\bfusion i3\b': 'internal-server-int',
    r'\bcoassistapi\b': 'cs-assist-api',
    r'\bHanbando\b': 'LegacyPlatform',
    r'\bhanbando\b': 'legacyplatform',
}

for pattern, repl in replacements.items():
    text = re.sub(pattern, repl, text, flags=re.IGNORECASE if 'fusion i3' in pattern else 0)

# Replace internal IPs (183.111.134.45, 172.30.247.147, 172.30.232.122)
ips = [r'183\.111\.134\.45', r'172\.30\.247\.147', r'172\.30\.232\.122']
for ip in ips:
    text = re.sub(ip, '10.0.0.1', text)

with open(cache_path, 'w', encoding='utf-8') as f:
    f.write(text)

print("Sanitization completed successfully.")
