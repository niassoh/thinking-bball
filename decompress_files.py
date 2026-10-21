import compress_json
import json

# Decompress both files
print("Decompressing 2025-data.json...")
data_2025 = compress_json.load('2025-data.json')

print("Decompressing 2026-data.json...")
data_2026 = compress_json.load('2026-data.json')

# Save them as regular JSON for inspection
print("\nSaving decompressed files...")
with open('2025-data-decompressed.json', 'w', encoding='utf-8') as f:
    json.dump(data_2025, f, indent=2, ensure_ascii=False)

with open('2026-data-decompressed.json', 'w', encoding='utf-8') as f:
    json.dump(data_2026, f, indent=2, ensure_ascii=False)

print("Done! Created 2025-data-decompressed.json and 2026-data-decompressed.json")
print(f"\n2025 data type: {type(data_2025)}")
print(f"2026 data type: {type(data_2026)}")

if isinstance(data_2025, dict):
    print(f"2025 keys: {list(data_2025.keys())[:10]}")
